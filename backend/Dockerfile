# SecureCargo API: FastAPI + MuJoCo.
# Cloudflare Containers only run linux/amd64 images, so the platform is pinned here.
FROM --platform=linux/amd64 python:3.11-slim-bookworm

COPY --from=ghcr.io/astral-sh/uv:0.13 /uv /uvx /bin/

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    UV_PROJECT_ENVIRONMENT=/opt/venv \
    PATH="/opt/venv/bin:$PATH"

WORKDIR /srv

# Install dependencies first so this layer is cached until the lockfile changes.
COPY pyproject.toml uv.lock .python-version ./
RUN uv sync --frozen --no-dev

COPY app ./app
COPY scene ./scene
COPY physics ./physics
COPY rules ./rules
COPY planner ./planner
COPY perception ./perception

# Fail the build early if the physics engine cannot be imported in this image.
RUN python -c "import mujoco; print('mujoco', mujoco.__version__)"

RUN useradd --create-home --uid 10001 securecargo \
    && mkdir -p /srv/data \
    && chown securecargo:securecargo /srv/data
USER securecargo

EXPOSE 8080
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8080"]
