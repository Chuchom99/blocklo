// routes/debug.js
import express from "express";
import redis from "../config/redis.js";

const router = express.Router();

router.post("/flush-redis", async (req, res) => {
  try {
    // CORRECT: ioredis uses uppercase
    await redis.FLUSHALL();

    // Optional: Clear only AI cache
    // await redis.del(await redis.keys("ai:*"));

    res.json({ success: true, message: "Redis cleared!" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;