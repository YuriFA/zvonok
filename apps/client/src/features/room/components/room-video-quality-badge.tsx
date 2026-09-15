import { usePeerQualityStats } from "@zvonok/react";

import { QualityIndicator } from "@/components/room/quality-indicator";

interface Props {
  userId: string;
}

export function RoomVideoQualityBadge({ userId }: Props) {
  const peerQuality = usePeerQualityStats(userId);

  if (!peerQuality) {
    return null;
  }

  return <QualityIndicator score={peerQuality.score} stats={peerQuality.stats} />;
}
