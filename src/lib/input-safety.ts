const MIN_ALPHANUMERIC_RATIO = 0.28;

function normalizeWhitespace(value: string) {
  return value.trim().replace(/\s+/g, " ");
}

function hasLongRepeatedCharacterRun(value: string) {
  return /(.)\1{8,}/i.test(value);
}

function hasVeryLowSignal(value: string) {
  const compactValue = value.replace(/\s+/g, "");

  if (compactValue.length < 8) {
    return false;
  }

  const alphanumericCount = (compactValue.match(/[a-z0-9]/gi) ?? []).length;
  return alphanumericCount / compactValue.length < MIN_ALPHANUMERIC_RATIO;
}

function hasRepeatedWordSpam(value: string) {
  const words = normalizeWhitespace(value)
    .toLowerCase()
    .split(" ")
    .filter((word) => word.length >= 3);
  const counts = new Map<string, number>();

  for (const word of words) {
    const count = (counts.get(word) ?? 0) + 1;

    if (count >= 5) {
      return true;
    }

    counts.set(word, count);
  }

  return false;
}

export function normalizeSafetyText(value: string) {
  return normalizeWhitespace(value);
}

export function getRoomTitleSafetyIssue(title: string) {
  const normalizedTitle = normalizeWhitespace(title);

  if (hasLongRepeatedCharacterRun(normalizedTitle)) {
    return "Room title has too many repeated characters.";
  }

  if (hasVeryLowSignal(normalizedTitle)) {
    return "Room title needs more readable text.";
  }

  if (hasRepeatedWordSpam(normalizedTitle)) {
    return "Room title looks too repetitive.";
  }

  return null;
}

export function getMessageSafetyIssue(message: string) {
  const normalizedMessage = normalizeWhitespace(message);

  if (hasLongRepeatedCharacterRun(normalizedMessage)) {
    return "Message has too many repeated characters.";
  }

  if (hasVeryLowSignal(normalizedMessage)) {
    return "Message needs more readable text.";
  }

  if (hasRepeatedWordSpam(normalizedMessage)) {
    return "Message looks too repetitive.";
  }

  return null;
}
