export type SlaVisualStatus = 'normal' | 'attention' | 'critical' | 'breached';

export interface SlaPolicy {
  responseMinutes: number | null;
  solutionMinutes: number | null;
}

export interface SlaTimestamps {
  startedAt: Date;
  firstResponseAt?: Date | null;
  resolvedAt?: Date | null;
  accumulatedPausedMinutes?: number | null;
  now?: Date;
}

export interface SlaDeadlines {
  responseDeadline: Date | null;
  solutionDeadline: Date | null;
}

export interface SlaMetricStatus {
  deadline: Date | null;
  consumedPercent: number | null;
  status: SlaVisualStatus;
  breached: boolean;
}

export interface SlaStatus {
  response: SlaMetricStatus;
  solution: SlaMetricStatus;
}

const MINUTE_MS = 60_000;

export function calculateSlaDeadlines(policy: SlaPolicy, timestamps: SlaTimestamps): SlaDeadlines {
  return {
    responseDeadline: addMinutes(timestamps.startedAt, policy.responseMinutes),
    solutionDeadline: addMinutes(
      timestamps.startedAt,
      policy.solutionMinutes === null ? null : policy.solutionMinutes + Math.max(0, timestamps.accumulatedPausedMinutes ?? 0),
    ),
  };
}

export function calculateSlaStatus(policy: SlaPolicy, timestamps: SlaTimestamps): SlaStatus {
  const now = timestamps.now ?? new Date();
  const deadlines = calculateSlaDeadlines(policy, timestamps);

  return {
    response: calculateMetricStatus(timestamps.startedAt, deadlines.responseDeadline, timestamps.firstResponseAt ?? null, now),
    solution: calculateMetricStatus(timestamps.startedAt, deadlines.solutionDeadline, timestamps.resolvedAt ?? null, now),
  };
}

export function incrementReopenCount(current: number | null | undefined): number {
  return Math.max(0, current ?? 0) + 1;
}

export function addWaitingCustomerTime(
  accumulatedPausedMinutes: number | null | undefined,
  waitingStartedAt: Date,
  customerRespondedAt: Date,
): number {
  return Math.max(0, accumulatedPausedMinutes ?? 0)
    + Math.max(0, Math.floor((customerRespondedAt.getTime() - waitingStartedAt.getTime()) / MINUTE_MS));
}

function calculateMetricStatus(startedAt: Date, deadline: Date | null, completedAt: Date | null, now: Date): SlaMetricStatus {
  if (deadline === null) {
    return {
      deadline,
      consumedPercent: null,
      status: 'normal',
      breached: false,
    };
  }

  const effectiveNow = completedAt ?? now;
  const totalMs = Math.max(1, deadline.getTime() - startedAt.getTime());
  const consumedPercent = Math.max(0, Math.round(((effectiveNow.getTime() - startedAt.getTime()) / totalMs) * 100));
  const breached = effectiveNow.getTime() > deadline.getTime();

  return {
    deadline,
    consumedPercent,
    status: breached ? 'breached' : visualStatusFromPercent(consumedPercent),
    breached,
  };
}

function visualStatusFromPercent(percent: number): SlaVisualStatus {
  if (percent >= 90) {
    return 'critical';
  }
  if (percent >= 70) {
    return 'attention';
  }

  return 'normal';
}

function addMinutes(start: Date, minutes: number | null): Date | null {
  if (minutes === null || !Number.isFinite(minutes) || minutes <= 0) {
    return null;
  }

  return new Date(start.getTime() + minutes * MINUTE_MS);
}
