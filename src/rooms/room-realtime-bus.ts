import { EventEmitter } from "node:events";

type MessageCreatedPayload = {
  message: unknown;
  roomId: string;
};

type ModerationActionAppliedPayload = {
  action: unknown;
  actionType: "ban" | "kick";
  actorUserId: string;
  createdAt: string;
  reason: null | string;
  roomId: string;
  targetUserId: string;
};

type ParticipantJoinedPayload = {
  roomId: string;
  userId: string;
};

type ParticipantLeftPayload = {
  leftAt: string;
  roomId: string;
  userId: string;
};

type RoomEndedPayload = {
  endedAt: string;
  endedByUserId: string;
  reason: "admin_action" | "host_closed" | "host_left" | "system_cleanup";
  roomId: string;
};

type RoomRealtimeEventMap = {
  "message.created": MessageCreatedPayload;
  "moderation.action.applied": ModerationActionAppliedPayload;
  "participant.joined": ParticipantJoinedPayload;
  "participant.left": ParticipantLeftPayload;
  "room.ended": RoomEndedPayload;
};

class RoomRealtimeBus extends EventEmitter {
  emitEvent<TEventName extends keyof RoomRealtimeEventMap>(
    eventName: TEventName,
    payload: RoomRealtimeEventMap[TEventName]
  ) {
    return this.emit(eventName, payload);
  }

  onEvent<TEventName extends keyof RoomRealtimeEventMap>(
    eventName: TEventName,
    listener: (payload: RoomRealtimeEventMap[TEventName]) => void
  ) {
    this.on(eventName, listener);
  }
}

export const roomRealtimeBus = new RoomRealtimeBus();
