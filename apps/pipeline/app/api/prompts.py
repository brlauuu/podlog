"""Prompts API — list / update / reset LLM system prompts (Issue #643)."""
import logging

from fastapi import APIRouter, Body, Depends, HTTPException
from sqlalchemy.orm import Session

from app.database import get_db
from app.services.prompts import list_prompts, reset_prompt, set_prompt

logger = logging.getLogger(__name__)

router = APIRouter()


@router.get("/prompts")
def get_prompts(db: Session = Depends(get_db)):
    return {"prompts": list_prompts(db)}


@router.put("/prompts/{key}")
def put_prompt(key: str, body: dict = Body(...), db: Session = Depends(get_db)):
    value = body.get("value")
    if not isinstance(value, str) or not value.strip():
        raise HTTPException(status_code=400, detail="value must be a non-empty string")
    try:
        set_prompt(db, key, value)
    except KeyError:
        raise HTTPException(status_code=404, detail=f"Unknown prompt key: {key}")
    logger.info('"action": "prompt_updated", "key": "%s", "length": %d', key, len(value))
    return {"ok": True}


@router.post("/prompts/{key}/reset")
def reset_prompt_endpoint(key: str, db: Session = Depends(get_db)):
    try:
        reset_prompt(db, key)
    except KeyError:
        raise HTTPException(status_code=404, detail=f"Unknown prompt key: {key}")
    logger.info('"action": "prompt_reset", "key": "%s"', key)
    return {"ok": True}
