from __future__ import annotations

import random
import re
from abc import ABC, abstractmethod
from collections import OrderedDict
from typing import Any
from urllib.parse import urlsplit

from loguru import logger
from playwright.sync_api import BrowserContext, Error as PlaywrightError, TimeoutError as PlaywrightTimeoutError

from .media_classifier import classify_media
from .schemas import CrawledArticle, DiscoveredLink, MediaAsset, ParagraphItem, Section
from .storage import CrawlStore
from .utils import clean_text, normalize_url


DISCOVERY_SCRIPT = """
() => {
  const anchors = Array.from(document.querySelectorAll("main a[href], article a[href], section a[href], body a[href]"));
  return anchors.slice(0, 4000).map((anchor, index) => {
    const href = anchor.href || anchor.getAttribute("href") || "";
    const container = anchor.closest("article, section, li, div");
    const headline = container?.querySelector("h1, h2, h3, h4, [data-testid*='headline']");
    const text = (headline?.textContent || anchor.innerText || anchor.textContent || "").trim();
    return { href, text, index };
  });
}
"""

ARTICLE_SCRIPT = """
() => {
  const clean = (value) => (value || "")
    .replace(/\\u00a0/g, " ")
    .replace(/\\s+\\n/g, "\\n")
    .replace(/[ \\t]+/g, " ")
    .replace(/\\n{3,}/g, "\\n\\n")
    .trim();

  const banned = /(subscribe|sign in|advertisement|cookie|newsletter|gift article|sponsored|listen to article|share article|catch up on the headlines|copyright ©|all rights reserved|appeared in the .* print edition|corrections?\\s*&\\s*amplifications?|news corp, owner of the wall street journal|victoria albert is a reporter|meghan bobrowsky is a technology reporter|zusha elinson is a national reporter|your guide to |myft digest|delivered directly to your inbox|https?:\\/\\/)/i;
  const exclusionPattern = /(related|newsletter|myft|latest on|latest headlines|get the newsletter|recommended|more on this story|most read|you may also like|also read|read more|promoted content|sign up|subscribe to|for the latest|more in |suggested|popular on|watch next|listen to |follow us|share this|next article|top stories)/i;
  const toAbsoluteUrl = (value) => {
    if (!value) {
      return "";
    }
    try {
      return new URL(value, window.location.href).href;
    } catch (error) {
      return String(value || "").trim();
    }
  };
  const getRect = (node) => {
    const rect = node?.getBoundingClientRect?.();
    if (!rect) {
      return null;
    }
    return {
      x: Number(rect.x || 0),
      y: Number(rect.y || 0),
      width: Number(rect.width || 0),
      height: Number(rect.height || 0)
    };
  };
  const isVisible = (node) => {
    if (!node) {
      return false;
    }
    const rect = getRect(node);
    if (!rect || rect.width < 120 || rect.height < 80) {
      return false;
    }
    const style = window.getComputedStyle(node);
    if (!style || style.display === "none" || style.visibility === "hidden" || Number(style.opacity || "1") === 0) {
      return false;
    }
    return true;
  };
  const MEDIA_QUERY = "img, svg, canvas, iframe, picture, video";
  const CONTAINER_SELECTORS = [
    "[data-module-name='ArticleBody']",
    "[class*='article-body']",
    "[class*='story-body']",
    "[data-testid*='article-body']",
    "[data-testid*='article']",
    "article",
    "main",
    "[role='main']"
  ];
  const TEXT_BLOCK_SELECTORS = [
    "figcaption",
    "h1",
    "h2",
    "h3",
    "h4",
    "h5",
    "h6",
    "p",
    "small",
    "[class*='caption']",
    "[class*='note']",
    "[class*='source']",
    "[class*='credit']",
    "[class*='title']",
    "[class*='headline']",
    "[data-testid*='caption']",
    "[data-testid*='title']",
    "[data-testid*='headline']"
  ];
  const getTextLines = (value) =>
    clean(String(value || ""))
      .split(/\\n+/)
      .map((line) => clean(line))
      .filter(Boolean);
  const shouldIgnoreText = (value) => {
    const normalized = clean(value);
    return !normalized || normalized.length < 4 || normalized.length > 700 || banned.test(normalized);
  };
  const hasExcludedMarker = (node) => {
    let current = node;
    for (let depth = 0; current && depth < 8; depth += 1, current = current.parentElement) {
      const marker = clean([
        current.id || "",
        typeof current.className === "string" ? current.className : "",
        current.getAttribute?.("data-testid") || "",
        current.getAttribute?.("data-trackable") || "",
        current.getAttribute?.("aria-label") || "",
        current.getAttribute?.("role") || ""
      ].join(" "));
      if (/related|newsletter|signup|subscribe|promo|recommended|most-read|read-more|latest|collection|digest|suggested|topic-list|more-on-this|share|follow|social/i.test(marker)) {
        return true;
      }
    }
    return false;
  };
  const isExcludedNode = (node) => {
    if (hasExcludedMarker(node)) {
      return true;
    }
    const text = clean(node?.innerText || node?.textContent || "").slice(0, 240);
    return exclusionPattern.test(text);
  };
  const candidateParagraphSelectors = [
    "p",
    "[data-testid*='paragraph']"
  ];
  const countParagraphs = (container) => {
    let count = 0;
    for (const selector of candidateParagraphSelectors) {
      for (const node of container.querySelectorAll(selector)) {
        const text = clean(node.textContent);
        if (!text || text.length < 40 || banned.test(text) || hasExcludedMarker(node)) {
          continue;
        }
        count += 1;
      }
    }
    return count;
  };
  const getArticleRoot = () => {
    const candidates = [];
    const headlineNode = document.querySelector("h1");
    const headlineRect = getRect(headlineNode);
    for (const selector of CONTAINER_SELECTORS) {
      for (const node of document.querySelectorAll(selector)) {
        const rect = getRect(node);
        if (!rect || rect.height < 200 || rect.width < 240) {
          continue;
        }
        const paragraphCount = countParagraphs(node);
        if (!paragraphCount) {
          continue;
        }
        let score = paragraphCount * 10;
        if (/article-body|story-body|article/i.test(String(node.className || "") + " " + String(node.getAttribute?.("data-testid") || ""))) {
          score += 20;
        }
        if (headlineNode && node.contains(headlineNode)) {
          score += 20;
        }
        if (headlineRect) {
          score -= Math.min(40, Math.abs(rect.y - headlineRect.y) / 30);
        }
        if (hasExcludedMarker(node)) {
          score -= 50;
        }
        candidates.push({ node, score, paragraphCount, rect });
      }
    }
    candidates.sort((a, b) => b.score - a.score || b.paragraphCount - a.paragraphCount || a.rect.y - b.rect.y);
    return candidates[0]?.node || document.querySelector("article") || document.querySelector("main") || document.body;
  };
  const collectContextTextBlocks = (container, visualNode) => {
    const containerRect = getRect(container);
    if (!containerRect) {
      return [];
    }
    const selector = TEXT_BLOCK_SELECTORS.join(",");
    const seenBlocks = new Set();
    const blocks = [];
    for (const node of container.querySelectorAll(selector)) {
      if (hasExcludedMarker(node)) {
        continue;
      }
      if (!isVisible(node)) {
        continue;
      }
      if (node === visualNode || node.contains(visualNode) || visualNode.contains(node)) {
        continue;
      }
      if (node.querySelector(MEDIA_QUERY)) {
        continue;
      }
      const rect = getRect(node);
      if (!rect) {
        continue;
      }
      if (rect.y < containerRect.y - 12 || rect.y + rect.height > containerRect.y + containerRect.height + 12) {
        continue;
      }
      if (rect.x < containerRect.x - 12 || rect.x + rect.width > containerRect.x + containerRect.width + 12) {
        continue;
      }
      const lines = getTextLines(node.innerText || node.textContent || "");
      if (!lines.length) {
        continue;
      }
      for (const line of lines) {
        if (shouldIgnoreText(line) || seenBlocks.has(line)) {
          continue;
        }
        seenBlocks.add(line);
        blocks.push({ text: line, rect });
      }
    }
    return blocks;
  };
  const pickChartTitle = (blocks, visualRect, precedingText) => {
    const preceding = clean(precedingText);
    const candidates = blocks
      .filter((block) => block.rect.y + block.rect.height <= visualRect.y + 12)
      .filter((block) => block.text.length <= 220)
      .filter((block) => !/^(note|source|credit)\\s*:/i.test(block.text))
      .filter((block) => !preceding || block.text !== preceding)
      .sort((a, b) => (b.rect.y + b.rect.height) - (a.rect.y + a.rect.height));
    return candidates[0]?.text || "";
  };
  const pickChartCaption = (blocks, visualRect, followingText) => {
    const following = clean(followingText);
    const candidates = blocks
      .filter((block) => block.rect.y >= visualRect.y + visualRect.height - 12)
      .filter((block) => block.rect.y - (visualRect.y + visualRect.height) <= 260)
      .filter((block) => !/^(advertisement|related articles?)$/i.test(block.text))
      .sort((a, b) => a.rect.y - b.rect.y || a.rect.x - b.rect.x);
    const lines = [];
    for (const block of candidates) {
      if (following && block.text === following) {
        continue;
      }
      if (!lines.includes(block.text)) {
        lines.push(block.text);
      }
    }
    return clean(lines.join(" "));
  };
  const findCaptureTarget = (target) => {
    const targetRect = getRect(target);
    if (!targetRect) {
      return target;
    }
    let captureTarget = target;
    let current = target.parentElement;
    let depth = 0;
    while (current && depth < 6 && current !== document.body) {
      const rect = getRect(current);
      if (!rect || !isVisible(current)) {
        current = current.parentElement;
        depth += 1;
        continue;
      }
      const widthGrowth = rect.width - targetRect.width;
      const heightGrowth = rect.height - targetRect.height;
      const textBlocks = collectContextTextBlocks(current, target);
      if (
        rect.width >= targetRect.width &&
        rect.width <= Math.min(window.innerWidth * 0.96, targetRect.width + 320) &&
        rect.height >= targetRect.height &&
        rect.height <= targetRect.height + 360 &&
        widthGrowth <= 320 &&
        heightGrowth <= 360 &&
        textBlocks.length
      ) {
        captureTarget = current;
        break;
      }
      current = current.parentElement;
      depth += 1;
    }
    return captureTarget;
  };

  const paragraphs = [];
  const paragraphItems = [];
  const seen = new Set();
  const articleRoot = getArticleRoot();
  const selectors = [
    "p",
    "[data-testid*='paragraph']",
  ];

  for (const selector of selectors) {
    for (const node of articleRoot.querySelectorAll(selector)) {
      const text = clean(node.textContent);
      const rect = getRect(node);
      if (!rect || !text || text.length < 40 || banned.test(text) || seen.has(text) || hasExcludedMarker(node)) {
        continue;
      }
      seen.add(text);
      const paragraphId = node.dataset.crawlerParagraphId || `crawler-paragraph-${paragraphItems.length + 1}`;
      node.dataset.crawlerParagraphId = paragraphId;
      paragraphs.push(text);
      paragraphItems.push({
        paragraph_id: paragraphId,
        order: paragraphItems.length + 1,
        text,
        bbox: rect
      });
    }
  }

  const paragraphNodes = Array.from(articleRoot.querySelectorAll(selectors.join(",")))
    .map((node) => ({ node, text: clean(node.textContent), rect: getRect(node), paragraph_id: node.dataset.crawlerParagraphId || "" }))
    .filter((item) => item.rect && item.text && item.text.length >= 40 && !banned.test(item.text) && !hasExcludedMarker(item.node));
  const paragraphBandTop = paragraphNodes.length ? Math.min(...paragraphNodes.map((item) => item.rect.y)) : 0;
  const paragraphBandBottom = paragraphNodes.length ? Math.max(...paragraphNodes.map((item) => item.rect.y + item.rect.height)) : 0;
  const isWithinParagraphBand = (rect) => {
    if (!rect || !paragraphNodes.length) {
      return true;
    }
    return rect.y + rect.height >= paragraphBandTop - 280 && rect.y <= paragraphBandBottom + 280;
  };

  const findNeighborParagraph = (target, direction) => {
    const targetRect = getRect(target);
    if (!targetRect) {
      return "";
    }

    let bestText = "";
    let bestDistance = Number.POSITIVE_INFINITY;

    for (const item of paragraphNodes) {
      if (!item.rect || !item.text) {
        continue;
      }
      if (target.contains(item.node) || item.node.contains(target)) {
        continue;
      }

      const distance =
        direction === "before"
          ? targetRect.y - (item.rect.y + item.rect.height)
          : item.rect.y - (targetRect.y + targetRect.height);
      if (distance < -12 || distance > 900) {
        continue;
      }
      if (distance < bestDistance) {
        bestDistance = distance;
        bestText = item.text;
      }
    }

    return bestText;
  };

  const mediaSelectors = [
    "article figure",
    "main figure",
    "figure",
    "article img",
    "main img",
    "article svg",
    "main svg",
    "article canvas",
    "main canvas",
    "article iframe",
    "main iframe"
  ];
  const mediaSeen = new Set();
  const media = [];

  for (const selector of mediaSelectors) {
    for (const rawNode of articleRoot.querySelectorAll(selector)) {
      if (hasExcludedMarker(rawNode)) {
        continue;
      }
      const visualTarget =
        rawNode.closest("figure") ||
        rawNode.closest("picture") ||
        rawNode;
      if (!visualTarget || !articleRoot.contains(visualTarget) || hasExcludedMarker(visualTarget) || !isVisible(visualTarget)) {
        continue;
      }
      const target = findCaptureTarget(visualTarget);
      if (!target || mediaSeen.has(target) || !isVisible(target)) {
        continue;
      }

      const imgNode = visualTarget.matches("img") ? visualTarget : visualTarget.querySelector("img") || target.querySelector("img");
      const svgNode = visualTarget.matches("svg") ? visualTarget : visualTarget.querySelector("svg") || target.querySelector("svg");
      const canvasNode = visualTarget.matches("canvas") ? visualTarget : visualTarget.querySelector("canvas") || target.querySelector("canvas");
      const iframeNode = visualTarget.matches("iframe") ? visualTarget : visualTarget.querySelector("iframe") || target.querySelector("iframe");
      const figcaptionNode = target.querySelector("figcaption");
      const creditNode = target.querySelector("[class*='credit'], [data-testid*='credit'], [aria-label*='credit' i]");

      let kind = "image";
      if (svgNode) {
        kind = "svg";
      } else if (canvasNode) {
        kind = "canvas";
      } else if (iframeNode) {
        kind = "interactive";
      }

      const src =
        toAbsoluteUrl(imgNode?.currentSrc || imgNode?.getAttribute("src") || imgNode?.getAttribute("data-src")) ||
        toAbsoluteUrl(iframeNode?.getAttribute("src")) ||
        "";
      const alt = clean(imgNode?.getAttribute("alt") || target.getAttribute("aria-label") || "");
      const precedingText = findNeighborParagraph(target, "before");
      const followingText = findNeighborParagraph(target, "after");
      const targetRect = getRect(target);
      if (!isWithinParagraphBand(targetRect)) {
        continue;
      }
      if (!precedingText && !followingText && !figcaptionNode && !target.querySelector("figcaption")) {
        continue;
      }
      const contextBlocks = collectContextTextBlocks(target, visualTarget);
      const mediaTitle = clean(
        pickChartTitle(contextBlocks, getRect(visualTarget) || targetRect, precedingText) ||
        target.getAttribute("data-title") ||
        ""
      );
      const caption = clean(
        figcaptionNode?.textContent ||
        target.getAttribute("data-caption") ||
        pickChartCaption(contextBlocks, getRect(visualTarget) || targetRect, followingText) ||
        ""
      );
      const credit = clean(creditNode?.textContent || "");
      const labelText = `${mediaTitle} ${alt} ${caption} ${credit}`.toLowerCase();
      if (kind === "image" && /(chart|graph|table|diagram|map|infographic)/.test(labelText)) {
        kind = "chart";
      }

      const rect = targetRect;
      if (!rect) {
        continue;
      }

      mediaSeen.add(target);
      const mediaId = target.dataset.crawlerMediaId || `crawler-media-${media.length + 1}`;
      target.dataset.crawlerMediaId = mediaId;

      media.push({
        media_id: mediaId,
        kind,
        order: media.length + 1,
        src,
        title: mediaTitle,
        alt,
        caption,
        credit,
        preceding_text: precedingText,
        following_text: followingText,
        bbox: rect
      });
    }
  }

  const scripts = Array.from(document.querySelectorAll("script[type='application/ld+json']"));
  const jsonLd = [];
  const visit = (node) => {
    if (!node) {
      return;
    }
    if (Array.isArray(node)) {
      for (const item of node) {
        visit(item);
      }
      return;
    }
    if (typeof node !== "object") {
      return;
    }
    jsonLd.push(node);
    if (node["@graph"]) {
      visit(node["@graph"]);
    }
    for (const value of Object.values(node)) {
      if (value && typeof value === "object") {
        visit(value);
      }
    }
  };

  for (const script of scripts) {
    try {
      visit(JSON.parse(script.textContent));
    } catch (error) {
      // ignore malformed json-ld
    }
  }

  const articleNode = jsonLd.find((node) => node.articleBody || String(node["@type"] || "").toLowerCase().includes("article"));
  const articleBody = clean(articleNode?.articleBody || "");
  const headline = clean(
    document.querySelector("meta[property='og:title']")?.content ||
    document.querySelector("meta[name='twitter:title']")?.content ||
    document.querySelector("h1")?.textContent ||
    articleNode?.headline ||
    document.title
  );
  const subtitle = clean(
    document.querySelector("[data-testid*='standfirst']")?.textContent ||
    document.querySelector("[class*='standfirst']")?.textContent ||
    document.querySelector("[class*='subtitle']")?.textContent ||
    document.querySelector("[class*='subhead']")?.textContent ||
    document.querySelector("meta[property='og:description']")?.content ||
    document.querySelector("meta[name='description']")?.content ||
    articleNode?.description ||
    ""
  );
  const canonicalUrl =
    document.querySelector("link[rel='canonical']")?.href ||
    document.querySelector("meta[property='og:url']")?.content ||
    window.location.href;

  return {
    title: headline,
    subtitle,
    url: canonicalUrl,
    article_text: clean(paragraphs.join("\\n\\n")) || articleBody,
    paragraph_count: paragraphs.length,
    paragraph_items: paragraphItems,
    title_from_document: clean(document.title),
    media_items: media
  };
}
"""


class BaseSiteCrawler(ABC):
    source_name: str
    base_url: str
    sections: tuple[Section, ...]
    allowed_hosts: tuple[str, ...]
    title_suffixes: tuple[str, ...] = ()
    denied_url_fragments: tuple[str, ...] = (
        "/video",
        "/podcast",
        "/audio",
        "/livecoverage/",
        "/newsletters",
        "/pro/",
    )

    def __init__(self, *, context: BrowserContext, store: CrawlStore, limit_per_section: int) -> None:
        self.context = context
        self.store = store
        self.limit_per_section = limit_per_section
        self.page = context.pages[0] if context.pages else context.new_page()

    @abstractmethod
    def is_article_url(self, url: str) -> bool:
        raise NotImplementedError

    def section_names(self) -> set[str]:
        return {section.name for section in self.sections}

    def crawl(self, *, selected_sections: set[str] | None = None) -> list[CrawledArticle]:
        articles: list[CrawledArticle] = []
        for section in self.sections:
            if selected_sections and section.name not in selected_sections:
                continue
            logger.info("Discovering {} stories from {}", self.source_name, section.url)
            for link in self.discover_section_links(section):
                normalized_url = normalize_url(link.url)
                if self.store.has_url(normalized_url):
                    logger.debug("Skipping existing article {}", normalized_url)
                    continue
                try:
                    payload = self.extract_article(link)
                    if self.store.has_url(payload["url"]):
                        logger.debug("Skipping existing canonical URL {}", payload["url"])
                        continue
                    article = self.store.save_article(
                        source=self.source_name,
                        section=link.section,
                        title=payload["title"],
                        subtitle=payload["subtitle"],
                        url=payload["url"],
                        article_text=payload["article_text"],
                        paragraphs=payload["paragraphs"],
                        media_assets=payload["media_assets"],
                    )
                    articles.append(article)
                    logger.info(
                        "Saved {} article '{}' -> {} ({} media)",
                        self.source_name,
                        article.title,
                        article.article_file_path,
                        article.media_count,
                    )
                except Exception as exc:
                    logger.warning("Failed to crawl {} article {}: {}", self.source_name, normalized_url, exc)
        return articles

    def discover_section_links(self, section: Section) -> list[DiscoveredLink]:
        self._navigate(section.url)
        self._settle_page()
        self.page.wait_for_timeout(2500)
        for _ in range(3):
            self.page.mouse.wheel(0, 1800)
            self.page.wait_for_timeout(750)

        raw_links: list[dict[str, Any]] = self.page.evaluate(DISCOVERY_SCRIPT)
        discovered: "OrderedDict[str, DiscoveredLink]" = OrderedDict()
        for item in raw_links:
            href = normalize_url(str(item.get("href", "")))
            if not href or href in discovered:
                continue
            if not self._is_allowed_host(href) or not self.is_article_url(href):
                continue
            title_hint = clean_text(str(item.get("text", "")))
            discovered[href] = DiscoveredLink(url=href, title_hint=title_hint, section=section.name)
            if len(discovered) >= self.limit_per_section:
                break
        return list(discovered.values())

    def extract_article(self, link: DiscoveredLink) -> dict[str, Any]:
        response = self._navigate(link.url)
        self._settle_page()
        self.page.wait_for_timeout(3000)

        payload: dict[str, Any] = self.page.evaluate(ARTICLE_SCRIPT)
        title = self._normalize_title(clean_text(str(payload.get("title", "")))) or link.title_hint
        subtitle = clean_text(str(payload.get("subtitle", "")))
        url = normalize_url(str(payload.get("url", "")) or link.url)
        article_text = clean_text(str(payload.get("article_text", "")))
        paragraphs = self._build_paragraph_items(payload.get("paragraph_items", []), article_text=article_text)
        media_assets = self._capture_media(payload.get("media_items", []))
        subtitle = self._normalize_subtitle(subtitle=subtitle, title=title, paragraphs=paragraphs)
        paragraphs = self._prune_paragraphs(paragraphs=paragraphs, subtitle=subtitle)
        article_text = "\n\n".join(paragraph.text for paragraph in paragraphs).strip()

        if not title:
            raise ValueError("missing article title")
        if len(article_text) < 400:
            raise ValueError(self._build_extraction_error(article_text_length=len(article_text), response_status=response.status if response else None))
        rejection_reason = self.reject_article(url=url, title=title, subtitle=subtitle, article_text=article_text, paragraphs=paragraphs)
        if rejection_reason:
            raise ValueError(rejection_reason)
        return {
            "title": title,
            "subtitle": subtitle,
            "url": url,
            "article_text": article_text,
            "paragraphs": paragraphs,
            "media_assets": media_assets,
        }

    def _is_allowed_host(self, url: str) -> bool:
        if any(fragment in url for fragment in self.denied_url_fragments):
            return False
        host = urlsplit(url).netloc.lower()
        return any(host == allowed_host or host.endswith(f".{allowed_host}") for allowed_host in self.allowed_hosts)

    def _normalize_title(self, title: str) -> str:
        normalized = title
        for suffix in self.title_suffixes:
            normalized = re.sub(rf"\s*[\-|:]\s*{re.escape(suffix)}$", "", normalized, flags=re.IGNORECASE)
        return normalized.strip()

    def _capture_media(self, raw_media: Any) -> list[MediaAsset]:
        if not isinstance(raw_media, list):
            return []

        media_assets: list[MediaAsset] = []
        seen_media_ids: set[str] = set()
        for item in raw_media:
            if not isinstance(item, dict):
                continue

            media_id = str(item.get("media_id", "")).strip()
            if not media_id or media_id in seen_media_ids:
                continue
            seen_media_ids.add(media_id)

            bbox = item.get("bbox")
            x = self._coerce_float(bbox.get("x")) if isinstance(bbox, dict) else 0.0
            y = self._coerce_float(bbox.get("y")) if isinstance(bbox, dict) else 0.0
            width = self._coerce_float(bbox.get("width")) if isinstance(bbox, dict) else 0.0
            height = self._coerce_float(bbox.get("height")) if isinstance(bbox, dict) else 0.0
            if width < 120 or height < 80:
                continue

            selector = f'[data-crawler-media-id="{media_id}"]'
            screenshot_bytes: bytes | None = None
            try:
                locator = self.page.locator(selector).first
                locator.scroll_into_view_if_needed(timeout=3_000)
                self.page.wait_for_timeout(200)
                screenshot_bytes = locator.screenshot(type="png", animations="disabled")
            except PlaywrightError as exc:
                logger.debug("Failed to capture media {} on {}: {}", media_id, self.page.url, exc)

            fallback_kind = clean_text(str(item.get("kind", "") or "image")).lower() or "image"
            classification = classify_media(
                fallback_kind=fallback_kind,
                screenshot_bytes=screenshot_bytes,
                title=clean_text(str(item.get("title", ""))),
                alt=clean_text(str(item.get("alt", ""))),
                caption=clean_text(str(item.get("caption", ""))),
                credit=clean_text(str(item.get("credit", ""))),
            )
            media_assets.append(
                MediaAsset(
                    media_id=media_id,
                    kind=classification.kind,
                    kind_source=classification.kind_source,
                    selector=selector,
                    order=max(1, int(self._coerce_float(item.get("order")) or len(media_assets) + 1)),
                    title=self._derive_media_title(
                        explicit_title=clean_text(str(item.get("title", ""))),
                        fallback_kind=classification.kind,
                        alt=clean_text(str(item.get("alt", ""))),
                    ),
                    src=str(item.get("src", "")).strip(),
                    alt=clean_text(str(item.get("alt", ""))),
                    caption=clean_text(str(item.get("caption", ""))),
                    credit=clean_text(str(item.get("credit", ""))),
                    preceding_text=clean_text(str(item.get("preceding_text", ""))),
                    following_text=clean_text(str(item.get("following_text", ""))),
                    x=x,
                    y=y,
                    width=width,
                    height=height,
                    chart_score=classification.chart_score,
                    ocr_word_count=classification.ocr_word_count,
                    ocr_avg_confidence=classification.ocr_avg_confidence,
                    ocr_text_excerpt=classification.ocr_text_excerpt,
                    screenshot_bytes=screenshot_bytes,
                )
            )
        return media_assets

    def _derive_media_title(self, *, explicit_title: str, fallback_kind: str, alt: str) -> str:
        if explicit_title:
            return explicit_title
        if fallback_kind != "chart":
            return ""

        normalized_alt = clean_text(alt)
        if not normalized_alt:
            return ""

        match = re.search(
            r"(?:showing|shows?)\s+(?P<title>.+?)(?:,\s+for\s+OpenAI|\s+for\s+OpenAI|,\s+including|,\s+represented|\.\s|$)",
            normalized_alt,
            flags=re.IGNORECASE,
        )
        if match:
            candidate = clean_text(match.group("title"))
        else:
            candidate = normalized_alt

        candidate = re.sub(r"^(series of [^ ]+ charts showing|two side-by-side bar charts showing)\s+", "", candidate, flags=re.IGNORECASE)
        candidate = clean_text(candidate.rstrip("."))
        if candidate:
            return candidate[0].upper() + candidate[1:]
        return ""

    def reject_article(
        self,
        *,
        url: str,
        title: str,
        subtitle: str,
        article_text: str,
        paragraphs: list[ParagraphItem],
    ) -> str | None:
        return None

    def _build_paragraph_items(self, raw_paragraphs: Any, *, article_text: str) -> list[ParagraphItem]:
        paragraph_items: list[ParagraphItem] = []
        if isinstance(raw_paragraphs, list):
            seen_ids: set[str] = set()
            for item in raw_paragraphs:
                if not isinstance(item, dict):
                    continue
                paragraph_id = str(item.get("paragraph_id", "")).strip() or f"paragraph-{len(paragraph_items) + 1}"
                if paragraph_id in seen_ids:
                    continue
                text = clean_text(str(item.get("text", "")))
                if not text:
                    continue
                bbox = item.get("bbox")
                y = self._coerce_float(bbox.get("y")) if isinstance(bbox, dict) else 0.0
                seen_ids.add(paragraph_id)
                paragraph_items.append(
                    ParagraphItem(
                        paragraph_id=paragraph_id,
                        text=text,
                        order=max(1, int(self._coerce_float(item.get("order")) or len(paragraph_items) + 1)),
                        y=y,
                    )
                )

        if paragraph_items:
            return paragraph_items

        fallback_lines = [clean_text(line) for line in article_text.splitlines() if clean_text(line)]
        return [
            ParagraphItem(paragraph_id=f"paragraph-{index}", text=text, order=index, y=float(index))
            for index, text in enumerate(fallback_lines, start=1)
        ]

    def _normalize_subtitle(self, *, subtitle: str, title: str, paragraphs: list[ParagraphItem]) -> str:
        normalized = subtitle.strip()
        if normalized and normalized.casefold() != title.strip().casefold():
            return normalized
        return ""

    def _prune_paragraphs(self, *, paragraphs: list[ParagraphItem], subtitle: str) -> list[ParagraphItem]:
        filtered: list[ParagraphItem] = []
        for paragraph in paragraphs:
            text = paragraph.text.strip()
            if not text:
                continue
            if subtitle and text.casefold() == subtitle.casefold():
                continue
            if text.casefold().startswith("your guide to "):
                continue
            filtered.append(paragraph)

        return [
            ParagraphItem(
                paragraph_id=paragraph.paragraph_id,
                text=paragraph.text,
                order=index,
                y=paragraph.y,
            )
            for index, paragraph in enumerate(filtered, start=1)
        ]

    def _settle_page(self) -> None:
        try:
            self.page.wait_for_load_state("networkidle")
        except PlaywrightTimeoutError:
            logger.debug("Timed out waiting for networkidle on {}", self.page.url)
        self._dismiss_popups()

    def _dismiss_popups(self) -> None:
        selectors = (
            "button[aria-label*='close' i]",
            "button[title*='close' i]",
            "[role='button'][aria-label*='close' i]",
            "[data-testid*='close' i]",
            "[class*='close' i] button",
            "button:has-text('Close')",
            "button:has-text('No thanks')",
            "button:has-text('Not now')",
            "button:has-text('Dismiss')",
            "button:has-text('Got it')",
            "button:has-text('Maybe later')",
        )
        for frame in (self.page.main_frame, *self.page.frames):
            for selector in selectors:
                try:
                    button = frame.locator(selector).first
                    if not button.is_visible(timeout=500):
                        continue
                    box = button.bounding_box()
                    if box and box["width"] <= 8:
                        continue
                    button.click(timeout=1_500)
                    self.page.wait_for_timeout(400)
                    logger.debug("Dismissed popup on {} via {}", self.page.url, selector)
                except PlaywrightError:
                    continue
        try:
            hidden_count = self.page.evaluate(
                """
                () => {
                  const hidden = [];
                  const nodes = Array.from(document.querySelectorAll("body *"));
                  for (const node of nodes) {
                    if (!(node instanceof HTMLElement)) {
                      continue;
                    }
                    const style = window.getComputedStyle(node);
                    if (!style) {
                      continue;
                    }
                    if (!["fixed", "sticky"].includes(style.position)) {
                      continue;
                    }
                    const rect = node.getBoundingClientRect();
                    if (!rect.width || !rect.height) {
                      continue;
                    }
                    if (rect.width < 40 || rect.height < 40) {
                      continue;
                    }
                    if (rect.width > window.innerWidth * 0.98 && rect.height > window.innerHeight * 0.45) {
                      continue;
                    }
                    const edgePinned =
                      rect.left <= 32 ||
                      rect.top <= 32 ||
                      window.innerWidth - rect.right <= 32 ||
                      window.innerHeight - rect.bottom <= 32;
                    const marker = `${node.id || ""} ${node.className || ""} ${node.getAttribute("data-testid") || ""} ${node.getAttribute("aria-label") || ""}`.toLowerCase();
                    const text = (node.innerText || node.textContent || "").replace(/\\s+/g, " ").trim().slice(0, 240).toLowerCase();
                    const looksLikeOverlay =
                      edgePinned &&
                      (
                        /cookie|consent|newsletter|subscribe|promo|advert|banner|sign up|follow|download app|app install|floating|sticky|toast|popup|overlay|myft/.test(marker) ||
                        /cookie|consent|newsletter|subscribe|sign up|follow|download app|install app|get our app|myft/.test(text)
                      );
                    if (!looksLikeOverlay) {
                      continue;
                    }
                    node.style.setProperty("display", "none", "important");
                    node.style.setProperty("visibility", "hidden", "important");
                    node.style.setProperty("pointer-events", "none", "important");
                    hidden.push(marker || text || node.tagName);
                  }
                  return hidden.length;
                }
                """
            )
            if hidden_count:
                logger.debug("Hidden {} persistent overlay nodes on {}", hidden_count, self.page.url)
        except PlaywrightError:
            pass

    def _navigate(self, url: str):
        self.page.wait_for_timeout(int(random.uniform(0, 5) * 1000))
        return self.page.goto(url, wait_until="domcontentloaded")

    def _coerce_float(self, value: Any) -> float:
        try:
            return float(value)
        except (TypeError, ValueError):
            return 0.0

    def _build_extraction_error(self, *, article_text_length: int, response_status: int | None) -> str:
        html = self.page.content().lower()
        body_text = clean_text(self.page.locator("body").inner_text())[:240]
        page_title = clean_text(self.page.title()).lower()

        if (
            ("datadome" in html or "captcha-delivery.com" in html)
            and any(token in f"{page_title} {body_text.lower()}" for token in ("captcha", "verify you are human", "press and hold", "robot"))
        ):
            status_text = f"HTTP {response_status}" if response_status else "an unknown HTTP status"
            return f"possible DataDome challenge page ({status_text})"
        if response_status and response_status >= 400:
            return f"received HTTP {response_status} with insufficient article text ({article_text_length} chars)"
        if body_text:
            return f"article text too short ({article_text_length} chars); body snippet: {body_text}"
        return f"article text too short ({article_text_length} chars)"
