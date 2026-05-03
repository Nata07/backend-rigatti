function createMockEmailService() {
  return {
    sendPasswordReset: jest.fn().mockResolvedValue({ id: "reset-email-1" }),
    sendVerificationEmail: jest.fn().mockResolvedValue({ id: "verification-email-1" }),
  };
}

function createMockLlmClient() {
  return {
    createChatCompletion: jest.fn(),
    streamChatCompletion: jest.fn(),
  };
}

module.exports = {
  createMockEmailService,
  createMockLlmClient,
};
