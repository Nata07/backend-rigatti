const { MongoMemoryServer } = require("mongodb-memory-server");

const mongoose = require("mongoose");

const { connectToDatabase, disconnectFromDatabase, getDatabaseStatus } = require("../../src/config/database");

describe("database connection", () => {
  let mongoServer;

  afterEach(async () => {
    await disconnectFromDatabase();
    if (mongoServer) {
      await mongoServer.stop();
      mongoServer = null;
    }
  });

  it("establishes a connection with a valid URI", async () => {
    mongoServer = await MongoMemoryServer.create();

    await connectToDatabase(mongoServer.getUri());

    expect(getDatabaseStatus()).toBe("connected");
  });

  it("fails gracefully with an invalid URI", async () => {
    await expect(
      connectToDatabase("mongodb://127.0.0.1:1/mini-saas-invalid", {
        serverSelectionTimeoutMS: 250,
      })
    ).rejects.toThrow(/Failed to connect to MongoDB/);
    expect(getDatabaseStatus()).toBe("disconnected");
  });

  it.each([
    [2, "connecting"],
    [3, "disconnecting"],
  ])("reports readyState %s as %s", (readyState, expectedStatus) => {
    const originalReadyState = mongoose.connection.readyState;

    Object.defineProperty(mongoose.connection, "readyState", {
      configurable: true,
      value: readyState,
    });

    expect(getDatabaseStatus()).toBe(expectedStatus);

    Object.defineProperty(mongoose.connection, "readyState", {
      configurable: true,
      value: originalReadyState,
    });
  });
});
