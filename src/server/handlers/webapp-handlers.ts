import { Context } from "hono";

import {
  renderAdminInterface,
  renderWebInterface,
} from "@/server/webapp/pages";
import { Auth, AuthUser } from "@/server/middleware/auth";

export const topPageHandler = async (c: Context) => {
  const authenticator = new Auth(c.env);
  const user = await authenticator.getCurrentUser(c);
  return c.html(renderWebInterface(user || undefined));
};

export const myPageHandler = async (c: Context) => {
  const user = (c as any).get("user") as AuthUser;
  return c.html(renderWebInterface(user));
};

export const adminPageHandler = async (c: Context) => {
  const user = (c as any).get("user") as AuthUser;
  return c.html(renderAdminInterface(user, c.env));
};
