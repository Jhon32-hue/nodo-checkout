module.exports = {
  importSPKI: jest.fn(async () => 'key'),
  EncryptJWT: jest.fn(function (value) {
    this.value = value;
    this.setProtectedHeader = () => this;
    this.encrypt = async () => 'encrypted-fixture';
  }),
};
