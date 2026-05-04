"use client";

import styled from "styled-components";

import { AsyncForm } from "@/components/async-form";
import { CalendarIcon, ClockIcon } from "@/components/icons";
import type { ArticleDashboardData } from "@/lib/article-dashboard";

const weekdayOptions = [
  { value: 0, label: "Mon" },
  { value: 1, label: "Tue" },
  { value: 2, label: "Wed" },
  { value: 3, label: "Thu" },
  { value: 4, label: "Fri" },
  { value: 5, label: "Sat" },
  { value: 6, label: "Sun" },
] as const;

const WeekdaySection = styled.div`
  display: grid;
  gap: 12px;
`;

const FieldLabel = styled.p`
  color: #0f172a;
  font-size: 0.875rem;
  font-weight: 700;
`;

const WeekdayGrid = styled.div`
  display: grid;
  grid-template-columns: repeat(7, minmax(0, 1fr));
  gap: 8px;
`;

const WeekdayOption = styled.label`
  cursor: pointer;
`;

const HiddenCheckbox = styled.input`
  position: absolute;
  width: 1px;
  height: 1px;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
`;

const WeekdayButton = styled.span`
  display: inline-flex;
  width: 100%;
  height: 40px;
  align-items: center;
  justify-content: center;
  border: 1px solid #e2e8f0;
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.78);
  color: rgba(15, 23, 42, 0.55);
  font-size: 0.75rem;
  font-weight: 700;
  transition:
    background-color 140ms ease,
    border-color 140ms ease,
    color 140ms ease;

  ${HiddenCheckbox}:checked + & {
    border-color: #0f172a;
    background: #0f172a;
    color: #ffffff;
  }
`;

const TimeRow = styled.div`
  display: grid;
  gap: 12px;
  margin-top: 28px;

  @media (min-width: 640px) {
    grid-template-columns: minmax(0, 1fr) auto;
    align-items: end;
  }
`;

const TimeLabel = styled.label`
  display: grid;
  gap: 8px;
  color: rgba(15, 23, 42, 0.7);
  font-size: 0.875rem;
`;

const TimeInput = styled.input`
  min-height: 44px;
  border: 1px solid #e2e8f0;
  border-radius: 16px;
  background: #ffffff;
  padding: 0 16px;
  color: #0f172a;
  font-size: 0.875rem;
  outline: none;
`;

const SaveButton = styled.button`
  display: inline-flex;
  min-height: 44px;
  align-items: center;
  justify-content: center;
  gap: 8px;
  border: 0;
  border-radius: 16px;
  background: #0f172a;
  padding: 0 16px;
  color: #ffffff;
  font-size: 0.875rem;
  font-weight: 700;

  &:hover {
    background: rgba(15, 23, 42, 0.9);
  }
`;

export function PipelineScheduleForm({
  schedule,
  scheduleKey,
  title,
  cadenceLabel,
  helper,
  maxCheckedValues,
}: {
  schedule: ArticleDashboardData["pipelineSchedules"][number] | null;
  scheduleKey: "daily_kakao_report" | "weekly_kakao_report";
  title: string;
  cadenceLabel: string;
  helper: string;
  maxCheckedValues?: number;
}) {
  const SaveIcon = scheduleKey === "weekly_kakao_report" ? CalendarIcon : ClockIcon;

  return (
    <AsyncForm
      action="/api/pipeline-schedules"
      checkboxGroupName="weekdays"
      maxCheckedValues={maxCheckedValues}
      maxCheckedMessage="Select only one weekday for the weekly Kakao report."
    >
      <input name="scheduleKey" type="hidden" value={scheduleKey} />
      <div className="mb-4 flex items-center justify-between gap-3">
        <div>
          <p className="text-base font-semibold tracking-[-0.03em] text-ink">{title}</p>
          <p className="mt-1 text-xs uppercase tracking-[0.14em] text-ink/45">{helper}</p>
        </div>
        <span className="rounded-full bg-ember/10 px-3 py-1 text-xs font-semibold text-ember">{cadenceLabel}</span>
      </div>
      <WeekdaySection>
        <FieldLabel>Select weekdays</FieldLabel>
        <WeekdayGrid>
          {weekdayOptions.map((weekday) => (
            <WeekdayOption key={`${scheduleKey}-${weekday.value}`}>
              <HiddenCheckbox defaultChecked={schedule?.weekdays.includes(weekday.value) ?? false} name="weekdays" type="checkbox" value={String(weekday.value)} />
              <WeekdayButton>{weekday.label}</WeekdayButton>
            </WeekdayOption>
          ))}
        </WeekdayGrid>
      </WeekdaySection>
      <TimeRow>
        <TimeLabel>
          <FieldLabel as="span">Time</FieldLabel>
          <TimeInput defaultValue={schedule?.timeOfDay ?? "09:00"} name="timeOfDay" type="time" />
        </TimeLabel>
        <SaveButton type="submit">
          <SaveIcon className="h-4 w-4" />
          Save
        </SaveButton>
      </TimeRow>
    </AsyncForm>
  );
}
