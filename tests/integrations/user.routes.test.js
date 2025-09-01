import request from "supertest";
import app from "../../app.js"; // Your Express app

describe("User Routes", () => {
  it("should register a new user", async () => {
    const res = await request(app).post("/api/users/register").send({
      email: "test@example.com",
      phone: "08012345678", 
      password: "securepassword123", 
      firstName: "John", 
      lastName: "Doe", 
      pin: "1234",
    });

    expect(res.statusCode).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body).toHaveProperty("user");
  });

  it("should login an existing user", async () => {
    const res = await request(app).post("/api/users/login").send({
      email: "test@example.com",
      password: "password123",
    });

    expect(res.statusCode).toBe(200);
    expect(res.body).toHaveProperty("token");
  });

  it("should verify user PIN", async () => {
    // First login to get token
    const loginRes = await request(app).post("/api/users/login").send({
      email: "test@example.com",
      password: "password123",
    });

    const token = loginRes.body.token;

    // Verify PIN request
    const pinRes = await request(app)
      .post("/api/users/verify-pin") // POST request if API expects body
      .set("Authorization", `Bearer ${token}`)
      .send({
        pin: "1234", // replace with your test PIN
      });

    expect(pinRes.statusCode).toBe(200);
    expect(pinRes.body.success).toBe(true); // check your actual response property
  });
});
