export function nextPayloadSession(current = 0) {
  return (Number(current) || 0) + 1;
}

export function payloadSessionOpen(session, current) {
  return Number(session) > 0 && Number(session) === Number(current);
}
