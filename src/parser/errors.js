export class BundleParseError extends Error {
  constructor(message, { path } = {}) {
    super(path ? `${message} (at ${path})` : message);
    this.name = 'BundleParseError';
    this.path = path ?? null;
  }
}
