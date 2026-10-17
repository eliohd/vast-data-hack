"""/api/clips — the slow lane. Short clips recorded on the phone are saved on the server and,
optionally, uploaded to VSS so the pipeline segments, describes, embeds and indexes them."""

from __future__ import annotations

import re
import time

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from pydantic import BaseModel

from app.services import Services, get_services

router = APIRouter(prefix="/api/clips", tags=["clips"])

ALLOWED_SUFFIXES = {".mp4", ".mov", ".webm", ".mkv", ".avi"}


class ClipSaved(BaseModel):
    filename: str
    bytes: int
    ingested: bool
    vss: dict | None = None


class ClipList(BaseModel):
    clips: list[str]


def safe_filename(name: str) -> str:
    stem = re.sub(r"[^A-Za-z0-9._-]+", "-", name).strip("-.") or "clip"
    return f"{time.strftime('%Y%m%d-%H%M%S')}-{stem}"[:120]


@router.post("", response_model=ClipSaved)
async def upload_clip(
    file: UploadFile = File(...),
    ingest: bool = Form(False),
    custom_prompt: str | None = Form(None),
    scenario: str | None = Form(None),
    camera_id: str | None = Form(None),
    location: str | None = Form(None),
    services: Services = Depends(get_services),
) -> ClipSaved:
    filename = safe_filename(file.filename or "clip.mp4")
    if not any(filename.lower().endswith(s) for s in ALLOWED_SUFFIXES):
        raise HTTPException(400, f"unsupported file type: {filename}")
    content = await file.read()
    if len(content) > services.settings.max_upload_mb * 1024 * 1024:
        raise HTTPException(413, "clip too large")

    clips_dir = services.settings.data_dir / "clips"
    clips_dir.mkdir(parents=True, exist_ok=True)
    (clips_dir / filename).write_bytes(content)

    vss_response = None
    if ingest:
        fields = {
            k: v
            for k, v in {
                "custom_prompt": custom_prompt,
                "scenario": scenario,
                "camera_id": camera_id or "phone-live",
                "location": location or "southwark",
                "capture_type": "general",
            }.items()
            if v
        }
        vss_response = await services.vss.upload(
            filename, content, file.content_type or "video/mp4", fields
        )
    return ClipSaved(filename=filename, bytes=len(content), ingested=ingest, vss=vss_response)


@router.get("", response_model=ClipList)
async def list_clips(services: Services = Depends(get_services)) -> ClipList:
    clips_dir = services.settings.data_dir / "clips"
    names = sorted(p.name for p in clips_dir.glob("*")) if clips_dir.is_dir() else []
    return ClipList(clips=names)
