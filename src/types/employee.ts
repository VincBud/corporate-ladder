/** The player's in-game employee identity. Entirely fictional. */
export interface Employee {
  id: string;
  displayName: string;
  employeeNumber: string;
  department: string;
  /** Position in the department's career track (signed-in members only). */
  jobTitle?: string | null;
  manager: string;
  location: string;
  xp: number;
  /** ISO date (YYYY-MM-DD). */
  joinedOn: string;
  /** True until accounts exist; progress is not persisted for guests. */
  isGuest: boolean;
}
