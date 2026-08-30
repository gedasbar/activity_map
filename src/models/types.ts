export interface UserProfile {
  uid: string;
  email: string;
  coupleId: string | null; // This acts like a foreign key to link you both
}

export interface VisitedLog {
  id?: string;
  coupleId: string;
  cityId: string;
  notes: string;
  dateVisited: number;
  photoUrls: string[];
  createdBy: string; // The uid of whoever posted it
}