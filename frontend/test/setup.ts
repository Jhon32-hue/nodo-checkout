import '@testing-library/jest-dom';
window.scrollTo = jest.fn();
Element.prototype.scrollIntoView = jest.fn();
Object.defineProperty(globalThis.crypto, 'randomUUID', {
  value: () => '55555555-5555-4555-8555-555555555555',
});
HTMLDialogElement.prototype.showModal = function () {
  this.setAttribute('open', '');
};
HTMLDialogElement.prototype.close = function () {
  this.removeAttribute('open');
};
