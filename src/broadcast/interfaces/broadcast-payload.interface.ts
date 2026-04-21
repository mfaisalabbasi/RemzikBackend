export interface BroadcastPayload {
  id?: string | number;
  title: string;
  message: string;
  target: string;
  createdAt: Date;
}
