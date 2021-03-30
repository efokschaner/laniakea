declare module 'basic-auth' {
  import { IncomingMessage } from 'http';

  interface Credentials {
    name: string;
    pass: string;
  }

  function auth(req: IncomingMessage): Credentials | undefined;

  interface auth {
    parse(authHeader: string): Credentials | undefined;
  }

  export = auth;
}
