const mongoose = require("mongoose");

async function connectToDatabase(mongoUri, options = {}) {
  try {
    await mongoose.connect(mongoUri, {
      serverSelectionTimeoutMS: options.serverSelectionTimeoutMS ?? 5000,
    });
  } catch (error) {
    const connectionError = new Error(`Failed to connect to MongoDB: ${error.message}`);
    connectionError.statusCode = 500;
    connectionError.cause = error;
    throw connectionError;
  }
}

async function disconnectFromDatabase() {
  if (mongoose.connection.readyState !== 0) {
    await mongoose.disconnect();
  }
}

function getDatabaseStatus() {
  switch (mongoose.connection.readyState) {
    case 1:
      return "connected";
    case 2:
      return "connecting";
    case 3:
      return "disconnecting";
    default:
      return "disconnected";
  }
}

module.exports = {
  connectToDatabase,
  disconnectFromDatabase,
  getDatabaseStatus,
};
