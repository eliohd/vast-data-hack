"""Messages on the /ws/live WebSocket. Mirrors web/src/lib/protocol.ts — change both together.

Wire format is camelCase (JS side); Python attributes are snake_case.
"""

from __future__ import annotations

import base64
import binascii
from typing import Annotated, Any, Literal

from pydantic import BaseModel, ConfigDict, Field, TypeAdapter
from pydantic.alias_generators import to_camel


class Wire(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)

    def dump(self) -> dict[str, Any]:
        return self.model_dump(by_alias=True, mode="json")


class Box(Wire):
    """Bounding box in normalised [0, 1] image coordinates."""

    label: str
    confidence: float = 1.0
    x: float
    y: float
    w: float
    h: float


class ClientFrame(Wire):
    type: Literal["frame"]
    seq: int
    captured_at: int
    image: str  # data:image/jpeg;base64,...
    width: int
    height: int
    prompt: str | None = None

    def jpeg_bytes(self) -> bytes:
        payload = self.image.split(",", 1)[1] if "," in self.image else self.image
        try:
            return base64.b64decode(payload, validate=True)
        except binascii.Error as exc:
            raise ValueError("frame image is not valid base64") from exc


class ClientPing(Wire):
    type: Literal["ping"]
    sent_at: int


ClientMessage = Annotated[ClientFrame | ClientPing, Field(discriminator="type")]
client_message_adapter: TypeAdapter[ClientFrame | ClientPing] = TypeAdapter(ClientMessage)


class ServerHello(Wire):
    type: Literal["hello"] = "hello"
    session_id: str
    analyser: str


class ServerResult(Wire):
    type: Literal["result"] = "result"
    seq: int
    captured_at: int
    processing_ms: int
    summary: str
    boxes: list[Box] = Field(default_factory=list)
    data: dict[str, Any] = Field(default_factory=dict)


class ServerPong(Wire):
    type: Literal["pong"] = "pong"
    sent_at: int


class ServerError(Wire):
    type: Literal["error"] = "error"
    seq: int | None = None
    message: str
