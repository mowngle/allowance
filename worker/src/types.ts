export interface Env {
  SCOREBOARD: KVNamespace;
}

export interface House {
  id: string;
  name: string;
  tokenHash: string;
  friendCode: string;
  createdAt: number;
}

export interface SummaryKid {
  name: string;
  avatar: string;
  pct: number;
  streak: number;
  choresDone: number;
  badges: string[];
}

export interface Summary {
  houseId: string;
  house: string;
  weekStarting: string;
  kids: SummaryKid[];
  updatedAt: number;
}

export interface Cheer {
  fromHouseId: string;
  fromHouse: string;
  fromName: string;
  avatar: string;
  phraseId: string;
  ts: number;
}

export interface LinkRequest {
  fromHouseId: string;
  fromName: string;
  ts: number;
}
