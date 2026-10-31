import { describe, expect, it } from "vitest";
import {
  CAREER_STORAGE_KEY,
  createLocalStorageCareerRepository,
  createMemoryCareerRepository,
  type CareerRepository,
} from "@/services/career-repository";
import { createCareerStore } from "./career-store";
import { CAREER_SCHEMA_VERSION } from "./schema";
import { FakeStorage, resultInput } from "./test-fixtures";

const localRepo = (storage: FakeStorage) => createLocalStorageCareerRepository(() => storage.asStorage());

describe("career store", () => {
  it("loads, records a round and exposes earned XP", async () => {
    const store = createCareerStore(createMemoryCareerRepository());
    await store.load();
    expect(store.getState()).toMatchObject({ status: "ready", earnedXp: 0, writable: true });
    const outcome = await store.recordResult("s1", resultInput({ score: 700 }));
    expect(outcome).toMatchObject({ status: "saved", duplicate: false, record: { xpAwarded: 35 } });
    expect(store.getState().earnedXp).toBe(35);
    expect(store.getState().sessions.get("s1")?.status).toBe("saved");
  });

  it("records concurrent and repeated completion events exactly once", async () => {
    const repository = createMemoryCareerRepository();
    const store = createCareerStore(repository);
    const results = await Promise.all([
      store.recordResult("s1", resultInput()),
      store.recordResult("s1", resultInput()),
      store.recordResult("s1", resultInput()),
    ]);
    await store.recordResult("s1", resultInput()); // e.g. reopening the report
    expect(new Set(results).size).toBe(1);
    expect(repository.saved.records).toHaveLength(1);
    expect(store.getState().earnedXp).toBe(35);
  });

  it("persists across reloads (a new store over the same storage)", async () => {
    const storage = new FakeStorage();
    const first = createCareerStore(localRepo(storage));
    await first.recordResult("s1", resultInput({ seed: "RR-1", score: 700 }));
    await first.recordResult("s2", resultInput({ seed: "RR-2", score: 300 }));

    const reloaded = createCareerStore(localRepo(storage));
    await reloaded.load();
    expect(reloaded.getState().records.map((r) => r.id)).toEqual(["s1", "s2"]);
    expect(reloaded.getState().earnedXp).toBe(50);
    // Recording an already-saved session after reload does not award XP again.
    const again = await reloaded.recordResult("s1", resultInput({ seed: "RR-1", score: 700 }));
    expect(again).toMatchObject({ status: "saved", duplicate: true });
    expect(reloaded.getState().earnedXp).toBe(50);
  });

  it("reports failure honestly and grants nothing when saving fails", async () => {
    const storage = new FakeStorage();
    const store = createCareerStore(localRepo(storage));
    await store.load();
    storage.failWrites = true;
    const outcome = await store.recordResult("s1", resultInput());
    expect(outcome.status).toBe("failed");
    expect(store.getState().earnedXp).toBe(0);
    expect(store.getState().records).toHaveLength(0);

    // A retry after storage recovers succeeds, once.
    storage.failWrites = false;
    expect((await store.recordResult("s1", resultInput())).status).toBe("saved");
    expect(store.getState().earnedXp).toBe(35);
  });

  it("works read-only when storage is unavailable", async () => {
    const storage = new FakeStorage();
    storage.failReads = true;
    const store = createCareerStore(localRepo(storage));
    await store.load();
    expect(store.getState()).toMatchObject({ loadStatus: "unavailable", writable: false });
    expect((await store.recordResult("s1", resultInput())).status).toBe("failed");

    const none = createCareerStore(createLocalStorageCareerRepository(() => null));
    await none.load();
    expect(none.getState().loadStatus).toBe("unavailable");
  });

  it("recovers from corrupt data and backs it up", async () => {
    const storage = new FakeStorage();
    storage.setItem(CAREER_STORAGE_KEY, "{{{definitely not json");
    const store = createCareerStore(localRepo(storage));
    await store.load();
    expect(store.getState()).toMatchObject({ loadStatus: "recovered", writable: true, earnedXp: 0 });
    expect(storage.getItem(`${CAREER_STORAGE_KEY}.corrupt`)).toBe("{{{definitely not json");
    expect((await store.recordResult("s1", resultInput())).status).toBe("saved");
    expect(JSON.parse(storage.getItem(CAREER_STORAGE_KEY)!).records).toHaveLength(1);
  });

  it("never overwrites data written by a newer schema version", async () => {
    const storage = new FakeStorage();
    const future = JSON.stringify({ version: CAREER_SCHEMA_VERSION + 1, records: [], newField: true });
    storage.setItem(CAREER_STORAGE_KEY, future);
    const store = createCareerStore(localRepo(storage));
    await store.load();
    expect(store.getState()).toMatchObject({ loadStatus: "unsupportedVersion", writable: false });
    expect((await store.recordResult("s1", resultInput())).status).toBe("failed");
    expect(storage.getItem(CAREER_STORAGE_KEY)).toBe(future);
  });

  it("merges with records saved by another tab instead of overwriting them", async () => {
    const storage = new FakeStorage();
    const tabA = createCareerStore(localRepo(storage));
    const tabB = createCareerStore(localRepo(storage));
    await tabA.load();
    await tabB.load();
    await tabA.recordResult("a", resultInput({ seed: "RR-A" }));
    await tabB.recordResult("b", resultInput({ seed: "RR-B" }));
    expect(JSON.parse(storage.getItem(CAREER_STORAGE_KEY)!).records.map((r: { id: string }) => r.id)).toEqual(["a", "b"]);
  });

  it("raises one promotion notice and lets it be dismissed", async () => {
    const store = createCareerStore(createMemoryCareerRepository(), { baselineXp: 290 });
    await store.recordResult("s1", resultInput({ score: 400 })); // +20 → 310: Intern
    expect(store.getState().promotion?.rankAfter.title).toBe("Intern");
    store.dismissPromotion();
    expect(store.getState().promotion).toBeNull();
    await store.recordResult("s1", resultInput({ score: 400 }));
    expect(store.getState().promotion).toBeNull();
  });

  it("notifies subscribers and loads on first subscription", async () => {
    let loads = 0;
    const repository: CareerRepository = {
      ...createMemoryCareerRepository(),
      async load() {
        loads++;
        return { save: { version: CAREER_SCHEMA_VERSION, records: [] }, status: "empty", writable: true, droppedRecords: 0 };
      },
    };
    const store = createCareerStore(repository);
    let calls = 0;
    const unsubscribe = store.subscribe(() => calls++);
    await Promise.resolve();
    await Promise.resolve();
    expect(loads).toBe(1);
    expect(calls).toBeGreaterThan(0);
    unsubscribe();
  });
});
