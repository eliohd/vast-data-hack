"""Short cyclist-facing wording, separate from action selection and route costs."""

from __future__ import annotations

from app.agent.hazard_types import Action


def distance_ahead(distance_m: float | None) -> str:
    if distance_m is None:
        return "ahead"
    if distance_m < 10:
        return "just ahead"
    if distance_m < 1000:
        return f"{round(distance_m / 10) * 10:g} m ahead"
    kilometres = f"{distance_m / 1000:.1f}".removesuffix(".0")
    return f"{kilometres} km ahead"


def duration_text(seconds: float) -> str:
    if seconds < 1:
        return "under 1 sec"
    if seconds < 60:
        return f"{round(seconds):g} sec"
    rounded = round(seconds / 10) * 10
    minutes, remainder = divmod(rounded, 60)
    return f"{minutes} min" + (f" {remainder} sec" if remainder else "")


def rider_reason(
    action: Action,
    ahead_m: float | None,
    estimated_delay_s: float | None,
    detour_cost_s: float | None,
    uncertain: bool,
) -> str:
    if action == "unavailable":
        return "Route advice unavailable. Check again shortly."
    if action == "continue":
        return "Keep riding. No active warnings ahead."
    if ahead_m is None:
        return "Route information is incomplete. Stay alert; delay unknown."
    obstruction = "Possible blockage" if uncertain else "Blockage"
    ahead = distance_ahead(ahead_m)
    if action == "reroute":
        if detour_cost_s is None:
            cost = "travel time unknown"
        elif abs(detour_cost_s) < 1:
            cost = "no extra time"
        elif detour_cost_s < 0:
            cost = f"about {duration_text(-detour_cost_s)} faster"
        else:
            cost = f"about {duration_text(detour_cost_s)} extra"
        return f"{obstruction} {ahead}. Take the detour; {cost}."
    if action == "wait" and estimated_delay_s is not None:
        return f"{obstruction} {ahead}. Wait about {duration_text(estimated_delay_s)}."
    instruction = "Slow down" if action == "slow" else "Stay alert"
    delay = (
        "delay uncertain"
        if uncertain or estimated_delay_s is None
        else (f"allow about {duration_text(estimated_delay_s)}")
    )
    return f"{obstruction} {ahead}. {instruction}; {delay}."
