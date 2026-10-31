"use client";

import { useEffect, useState } from "react";
import { httpCompanySource, onCompanyChanged } from "@/services/company-source";
import type { CompanyDataSource, CompanySnapshot, CompanySnapshotResult } from "@/simulation/source";

export type LiveCompanyState =
  | { status: "loading" }
  | { status: "notConfigured" }
  | { status: "unavailable"; message: string; snapshot: CompanySnapshot | null }
  | { status: "ok"; snapshot: CompanySnapshot };

/**
 * Loads the live company snapshot, refreshes it on demand and whenever a
 * verified contribution is recorded in this browser. No polling or realtime.
 * A failed refresh keeps showing the last good snapshot, marked as stale.
 */
export function useLiveCompany(source: CompanyDataSource = httpCompanySource) {
  const [state, setState] = useState<LiveCompanyState>({ status: "loading" });
  const [refreshing, setRefreshing] = useState(false);

  const apply = (result: CompanySnapshotResult) => {
    setRefreshing(false);
    setState((previous) => {
      if (result.status === "ok") return { status: "ok", snapshot: result.snapshot };
      if (result.status === "notConfigured") return { status: "notConfigured" };
      const last = previous.status === "ok" ? previous.snapshot : previous.status === "unavailable" ? previous.snapshot : null;
      return { status: "unavailable", message: result.message, snapshot: last };
    });
  };

  const refresh = () => {
    setRefreshing(true);
    void source.loadSnapshot().then(apply);
  };

  useEffect(() => {
    let active = true;
    void source.loadSnapshot().then((result) => {
      if (active) apply(result);
    });
    const unsubscribe = onCompanyChanged(() => {
      setRefreshing(true);
      void source.loadSnapshot().then((result) => {
        if (active) apply(result);
      });
    });
    return () => {
      active = false;
      unsubscribe();
    };
  }, [source]);

  return { state, refreshing, refresh };
}
