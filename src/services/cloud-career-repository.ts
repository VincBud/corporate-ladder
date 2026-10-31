/**
 * Career repository for signed-in players. Reads the server's verified
 * history; it never writes, because results are recorded by the server when
 * a verified round is submitted.
 */
import { CAREER_SCHEMA_VERSION } from "@/performance/schema";
import type { CareerResponse } from "@/types/cloud-career";
import { ApiError } from "./api-client";
import type { CareerRepository, LoadResult } from "./career-repository";

const EMPTY = { version: CAREER_SCHEMA_VERSION, records: [] } as const;

export function createCloudCareerRepository(fetchCareer: () => Promise<CareerResponse>): CareerRepository {
  return {
    async load(): Promise<LoadResult> {
      try {
        const data = await fetchCareer();
        return {
          save: { version: CAREER_SCHEMA_VERSION, records: data.records },
          status: data.records.length ? "ok" : "empty",
          writable: false,
          droppedRecords: 0,
          cloud: { totalXp: data.totalXp, profile: data.profile, legacy: data.legacy, departments: data.departments },
        };
      } catch (error) {
        const status = error instanceof ApiError && (error.status === 401 || error.status === 403) ? "unauthorized" : "offline";
        return { save: { ...EMPTY, records: [] }, status, writable: false, droppedRecords: 0 };
      }
    },
    async save() {
      throw new Error("Cloud history is written by the server, not the browser.");
    },
  };
}
