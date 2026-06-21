import {
  __test,
  findLocalUserByCredentials,
  getLocalAuthUsers,
  getLocalUser,
  localAuthIsConfigured,
} from "../../src/lib/auth/session";
import { assert, assertEqual, defineSuite } from "./_assert";

export const authSession = defineSuite("auth/session");

const ENV_KEYS = [
  "APP_AUTH_EMAIL",
  "APP_AUTH_NAME",
  "APP_AUTH_PASSWORD",
  "APP_AUTH_USERS_JSON",
  "APP_LOCAL_USER_ID",
  "APP_SESSION_SECRET",
] as const;

function withAuthEnv(values: Partial<Record<(typeof ENV_KEYS)[number], string>>, fn: () => void) {
  const previous = new Map<string, string | undefined>();
  ENV_KEYS.forEach((key) => {
    previous.set(key, process.env[key]);
    delete process.env[key];
  });
  Object.entries(values).forEach(([key, value]) => {
    if (value !== undefined) process.env[key] = value;
  });

  try {
    fn();
  } finally {
    previous.forEach((value, key) => {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    });
  }
}

authSession.test("legacy local auth user still works", () => {
  withAuthEnv(
    {
      APP_AUTH_EMAIL: "admin@example.com",
      APP_AUTH_NAME: "Admin",
      APP_AUTH_PASSWORD: "admin-secret",
      APP_LOCAL_USER_ID: "00000000-0000-4000-8000-000000000001",
      APP_SESSION_SECRET: "session-secret",
    },
    () => {
      assert(localAuthIsConfigured());
      assertEqual(getLocalAuthUsers().length, 1);
      assertEqual(getLocalUser().email, "admin@example.com");
      assertEqual(
        findLocalUserByCredentials("admin@example.com", "admin-secret")?.name,
        "Admin"
      );
    }
  );
});

authSession.test("APP_AUTH_USERS_JSON adds member logins", () => {
  withAuthEnv(
    {
      APP_AUTH_EMAIL: "admin@example.com",
      APP_AUTH_NAME: "Admin",
      APP_AUTH_PASSWORD: "admin-secret",
      APP_AUTH_USERS_JSON: JSON.stringify([
        {
          email: "member@example.com",
          password: "member-secret",
          name: "Member",
          id: "11111111-1111-4111-8111-111111111111",
        },
      ]),
      APP_SESSION_SECRET: "session-secret",
    },
    () => {
      assertEqual(getLocalAuthUsers().length, 2);
      assertEqual(
        findLocalUserByCredentials("member@example.com", "member-secret")?.id,
        "11111111-1111-4111-8111-111111111111"
      );
      assertEqual(findLocalUserByCredentials("member@example.com", "wrong"), null);
    }
  );
});

authSession.test("additional member ids are deterministic UUIDs when omitted", () => {
  withAuthEnv(
    {
      APP_AUTH_USERS_JSON: JSON.stringify([
        { email: "member@example.com", password: "member-secret", name: "Member" },
      ]),
      APP_SESSION_SECRET: "session-secret",
    },
    () => {
      const user = findLocalUserByCredentials("member@example.com", "member-secret");
      assert(user, "member should authenticate");
      assertEqual(user.id, __test.uuidFromText("member@example.com"));
      assert(/^[0-9a-f-]{36}$/.test(user.id), "derived id should look like UUID");
      assert(localAuthIsConfigured());
    }
  );
});
