import type { Category, Message, Room, RoomParticipant, User } from "@prisma/client";

type RoomWithRelations = Room & {
  _count?: {
    participants: number;
  };
  category: Category;
  host: User;
};

type ParticipantWithUser = RoomParticipant & {
  user: User;
};

type MessageWithUser = Message & {
  user: User;
};

export function toRoomResponse(room: RoomWithRelations) {
  return {
    activeParticipantCount: room._count?.participants ?? 0,
    category: {
      id: room.category.id,
      name: room.category.name,
      slug: room.category.slug
    },
    createdAt: room.createdAt.toISOString(),
    endedAt: room.endedAt ? room.endedAt.toISOString() : null,
    host: {
      avatarUrl: room.host.avatarUrl,
      displayName: room.host.displayName,
      id: room.host.id,
      username: room.host.username
    },
    id: room.id,
    participantLimit: room.participantLimit,
    slug: room.slug,
    source: {
      provider: room.sourceProvider,
      thumbnailUrl: room.sourceThumbnailUrl,
      title: room.sourceTitle,
      url: room.sourceUrl,
      videoId: room.sourceVideoId
    },
    state: room.state,
    title: room.title,
    updatedAt: room.updatedAt.toISOString(),
    visibility: room.visibility
  };
}

export function toParticipantResponse(participant: ParticipantWithUser) {
  return {
    id: participant.id,
    joinedAt: participant.joinedAt.toISOString(),
    leftAt: participant.leftAt ? participant.leftAt.toISOString() : null,
    role: participant.role,
    state: participant.state,
    user: {
      avatarUrl: participant.user.avatarUrl,
      displayName: participant.user.displayName,
      id: participant.user.id,
      username: participant.user.username
    }
  };
}

export function toMessageResponse(message: MessageWithUser) {
  return {
    author: {
      avatarUrl: message.user.avatarUrl,
      displayName: message.user.displayName,
      id: message.user.id,
      username: message.user.username
    },
    body: message.body,
    createdAt: message.createdAt.toISOString(),
    id: message.id,
    roomId: message.roomId,
    state: message.state
  };
}
