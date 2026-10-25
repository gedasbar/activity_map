export interface UserProfile {
  uid: string;
  email?: string; // older accounts have a profile with only a coupleId
  coupleId: string | null; // the couple this user belongs to (see Couple)
}

// couples/{coupleId}. Older couples use a user's uid as the document id; new ones use a random id.
export interface Couple {
  members: string[]; // uids, at most two
  createdAt: number;
  createdBy: string;
  joinCode?: string; // set by the join flow so security rules can find the invite being redeemed
}

// invites/{code}: single use, expires after 24 hours.
export interface Invite {
  coupleId: string;
  createdBy: string;
  createdAt: number;
  expiresAt: number;
  used: boolean;
  usedBy?: string;
  usedAt?: number;
}

export interface CoupleMember {
  uid: string;
  email: string | null;
  isMe: boolean;
}

export interface VisitedLog {
  id?: string;
  coupleId: string;
  cityId: string;
  placeId?: string | number;
  notes: string;
  dateVisited: number;
  photoUrls: string[];
  createdBy: string; // The uid of whoever posted it
}
