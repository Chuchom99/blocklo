import { jest } from "@jest/globals";
import { mockInfra } from "../helpers/fakes.js";

const { queues } = mockInfra();
const workers = [];
jest.unstable_mockModule("bullmq", () => ({
  Worker: jest.fn().mockImplementation((name) => {
    const w = { name, on: jest.fn() };
    workers.push(w);
    return w;
  }),
  Queue: jest.fn(),
}));

test("the worker process boots and schedules maintenance jobs", async () => {
  const { startWorkers } = await import("../../jobs/workers.js");
  await startWorkers();
  expect(workers.map((w) => w.name).sort()).toEqual(["maintenance", "payments", "psb-webhook", "whatsapp-inbound"]);
  expect(queues.maintenanceQueue.upsertJobScheduler).toHaveBeenCalledWith("reconcile", expect.anything(), expect.anything());
  expect(queues.maintenanceQueue.upsertJobScheduler).toHaveBeenCalledWith("expire-intents", expect.anything(), expect.anything());
});
