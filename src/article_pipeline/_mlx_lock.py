import threading

# MLX runs on Apple Silicon's unified Metal device. Concurrent inference calls
# from multiple threads cause Metal command buffer assertion failures. All MLX
# inference (Gemma 4 via mlx-vlm, TranslateGemma via mlx-lm) must hold this
# lock for the duration of the generate() call.
MLX_LOCK = threading.Lock()
