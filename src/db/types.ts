export type EventStatus = "pending" | "processing" | "completed" | "failed";

export type EventRecord = {
  id: string;
  topic: string;
  body: string;
  metadata: string | null;
  correlation_id: string | null;
  parent_id: string | null;
  status: EventStatus;
  source: string;
  created_at: number;
  processed_at: number | null;
  claimed_by: string | null;
  claimed_at: number | null;
  expires_at: number | null;
};

export type TopicRecord = {
  name: string;
  system_prompt: string | null;
  description: string | null;
  created_at: number;
};
