import assert from "node:assert/strict";
import test from "node:test";

import {
  AuthWorkspaceBoundary,
  DeterministicLocalAuthorizationDirectory,
  DeterministicLocalIdentityProvider,
  REVIEWER_MUTATION_PAYLOAD_LIMITS,
} from "../dist/src/auth/index.js";

const NOW = Date.parse("2026-08-10T09:00:00.000Z");
const WORKSPACE_A = "workspace_auth_a";
const WORKSPACE_B = "workspace_auth_b";
const WORKSPACE_ARCHIVED = "workspace_auth_archived";

const plainJson = (value) => JSON.parse(JSON.stringify(value));

function sessionFixture({
  token,
  userId,
  email,
  status = "ACTIVE",
  issuedAt = "2026-08-10T08:00:00.000Z",
  expiresAt = "2026-08-10T10:00:00.000Z",
}) {
  return Object.freeze({
    sessionToken: token,
    session: Object.freeze({
      sessionId: `session_${userId}`,
      userId,
      normalizedEmail: email,
      provider: "LOCAL",
      status,
      issuedAt,
      expiresAt,
    }),
  });
}

function accessRecord({
  workspaceId = WORKSPACE_A,
  workspaceStatus = "ACTIVE",
  userId = "user_active",
  email = "active@example.test",
  userStatus = "ACTIVE",
  invitationStatus = "ACCEPTED",
  membershipStatus = "ACTIVE",
  role = "MEMBER",
}) {
  return Object.freeze({
    workspace: Object.freeze({ workspaceId, status: workspaceStatus }),
    identity: Object.freeze({ userId, normalizedEmail: email, status: userStatus }),
    invitation: Object.freeze({
      workspaceId,
      normalizedEmail: email,
      status: invitationStatus,
    }),
    membership: Object.freeze({
      membershipId: `membership_${workspaceId}_${userId}`,
      workspaceId,
      userId,
      role,
      status: membershipStatus,
    }),
  });
}

const SESSION_FIXTURES = Object.freeze([
  sessionFixture({
    token: "token_active",
    userId: "user_active",
    email: "active@example.test",
  }),
  sessionFixture({
    token: "token_uninvited",
    userId: "user_uninvited",
    email: "uninvited@example.test",
  }),
  sessionFixture({
    token: "token_pending",
    userId: "user_pending",
    email: "pending@example.test",
  }),
  sessionFixture({
    token: "token_archived_member",
    userId: "user_archived_member",
    email: "archived-member@example.test",
  }),
  sessionFixture({
    token: "token_suspended",
    userId: "user_suspended",
    email: "suspended@example.test",
  }),
  sessionFixture({
    token: "token_disabled",
    userId: "user_disabled",
    email: "disabled@example.test",
  }),
  sessionFixture({
    token: "token_archived_workspace",
    userId: "user_archived_workspace",
    email: "archived-workspace@example.test",
  }),
  sessionFixture({
    token: "token_revoked_invitation",
    userId: "user_revoked_invitation",
    email: "revoked-invitation@example.test",
  }),
  sessionFixture({
    token: "token_expired",
    userId: "user_expired",
    email: "expired@example.test",
    expiresAt: "2026-08-10T08:59:59.999Z",
  }),
  sessionFixture({
    token: "token_revoked_session",
    userId: "user_revoked_session",
    email: "revoked-session@example.test",
    status: "REVOKED",
  }),
]);

const ACCESS_RECORDS = Object.freeze([
  accessRecord({}),
  accessRecord({
    userId: "user_pending",
    email: "pending@example.test",
    invitationStatus: "PENDING",
    membershipStatus: "INVITED",
  }),
  accessRecord({
    userId: "user_archived_member",
    email: "archived-member@example.test",
    membershipStatus: "ARCHIVED",
  }),
  accessRecord({
    userId: "user_suspended",
    email: "suspended@example.test",
    membershipStatus: "SUSPENDED",
  }),
  accessRecord({
    userId: "user_disabled",
    email: "disabled@example.test",
    userStatus: "DISABLED",
  }),
  accessRecord({
    workspaceId: WORKSPACE_ARCHIVED,
    workspaceStatus: "ARCHIVED",
    userId: "user_archived_workspace",
    email: "archived-workspace@example.test",
  }),
  accessRecord({
    userId: "user_revoked_invitation",
    email: "revoked-invitation@example.test",
    invitationStatus: "REVOKED",
  }),
]);

function createBoundary({ sessions = SESSION_FIXTURES, records = ACCESS_RECORDS } = {}) {
  return new AuthWorkspaceBoundary({
    sessions: new DeterministicLocalIdentityProvider(sessions),
    directory: new DeterministicLocalAuthorizationDirectory(records),
    clock: Object.freeze({ nowEpochMs: () => NOW }),
  });
}

const WORKSPACE_DENIED = Object.freeze({
  ok: false,
  problem: Object.freeze({
    code: "WORKSPACE_ACCESS_REQUIRED",
    status: 403,
    title: "Workspace access is required",
    detail: "This account is not authorized for the requested workspace.",
    retryable: false,
  }),
});

const AUTHENTICATION_DENIED = Object.freeze({
  ok: false,
  problem: Object.freeze({
    code: "AUTHENTICATION_REQUIRED",
    status: 401,
    title: "Authentication is required",
    detail: "Continue with an invited account before requesting workspace data or actions.",
    retryable: false,
  }),
});

const REVIEWER_FORBIDDEN = Object.freeze({
  ok: false,
  problem: Object.freeze({
    code: "CLIENT_REVIEWER_IDENTITY_FORBIDDEN",
    status: 422,
    title: "Reviewer identity must not be supplied",
    detail: "Reviewer identity is derived only from the authenticated server session.",
    retryable: false,
  }),
});

test("an accepted invitation plus active identity, workspace, membership, and session authorizes exactly one scope", async () => {
  const result = await createBoundary().authorizeWorkspace({
    sessionToken: "token_active",
    workspaceId: WORKSPACE_A,
  });

  assert.deepEqual(result, {
    ok: true,
    value: {
      authorized: true,
      reason: "ACTIVE_MEMBER",
      principal: {
        sessionId: "session_user_active",
        userId: "user_active",
        normalizedEmail: "active@example.test",
        provider: "LOCAL",
      },
      workspace: {
        workspaceId: WORKSPACE_A,
        membershipId: "membership_workspace_auth_a_user_active",
        role: "MEMBER",
      },
    },
  });
  assert.equal(Object.isFrozen(result), true);
  assert.equal(Object.isFrozen(result.value), true);
  assert.equal(Object.isFrozen(result.value.principal), true);
  assert.equal(Object.isFrozen(result.value.workspace), true);
});

test("verified Google sign-in is allowlisted only by a pending or accepted invitation in an active workspace", async () => {
  const boundary = createBoundary();
  assert.deepEqual(
    await boundary.authorizeInvitedGoogleSignIn({
      workspaceId: WORKSPACE_A,
      email: " Pending@Example.test ",
      emailVerified: true,
    }),
    {
      ok: true,
      value: {
        allowed: true,
        reason: "INVITED_VERIFIED_GOOGLE_EMAIL",
        workspaceId: WORKSPACE_A,
        normalizedEmail: "pending@example.test",
        materialization: {
          mode: "ACTIVATE_INVITATION",
          expectedIdentityStatus: "ACTIVE",
          expectedInvitationStatus: "PENDING",
          expectedMembershipStatus: "INVITED",
          resultingInvitationStatus: "ACCEPTED",
          resultingMembershipStatus: "ACTIVE",
          transactionRequired: true,
        },
      },
    },
  );
  assert.deepEqual(
    await boundary.authorizeInvitedGoogleSignIn({
      workspaceId: WORKSPACE_A,
      email: "active@example.test",
      emailVerified: true,
    }),
    {
      ok: true,
      value: {
        allowed: true,
        reason: "INVITED_VERIFIED_GOOGLE_EMAIL",
        workspaceId: WORKSPACE_A,
        normalizedEmail: "active@example.test",
        materialization: {
          mode: "ALREADY_ACTIVE",
          expectedIdentityStatus: "ACTIVE",
          expectedInvitationStatus: "ACCEPTED",
          expectedMembershipStatus: "ACTIVE",
          resultingInvitationStatus: "ACCEPTED",
          resultingMembershipStatus: "ACTIVE",
          transactionRequired: true,
        },
      },
    },
  );

  for (const request of [
    { workspaceId: WORKSPACE_A, email: "uninvited@example.test", emailVerified: true },
    {
      workspaceId: WORKSPACE_A,
      email: "revoked-invitation@example.test",
      emailVerified: true,
    },
    {
      workspaceId: WORKSPACE_ARCHIVED,
      email: "archived-workspace@example.test",
      emailVerified: true,
    },
    { workspaceId: WORKSPACE_A, email: "pending@example.test", emailVerified: false },
    { workspaceId: WORKSPACE_A, email: "disabled@example.test", emailVerified: true },
    { workspaceId: WORKSPACE_A, email: "not-an-email", emailVerified: true },
    { workspaceId: WORKSPACE_B, email: "active@example.test", emailVerified: true },
  ]) {
    assert.deepEqual(await boundary.authorizeInvitedGoogleSignIn(request), WORKSPACE_DENIED);
  }
});

test("uninvited, pending, archived, suspended, disabled, revoked, and wrong-workspace cases have one non-leaking denial", async () => {
  const boundary = createBoundary();
  const cases = [
    ["token_uninvited", WORKSPACE_A],
    ["token_active", WORKSPACE_B],
    ["token_pending", WORKSPACE_A],
    ["token_archived_member", WORKSPACE_A],
    ["token_suspended", WORKSPACE_A],
    ["token_disabled", WORKSPACE_A],
    ["token_archived_workspace", WORKSPACE_ARCHIVED],
    ["token_revoked_invitation", WORKSPACE_A],
  ];

  for (const [sessionToken, workspaceId] of cases) {
    const result = await boundary.authorizeWorkspace({ sessionToken, workspaceId });
    assert.deepEqual(result, WORKSPACE_DENIED, `${sessionToken} must fail generically`);
    const publicBytes = JSON.stringify(result);
    assert.equal(publicBytes.includes(sessionToken), false);
    assert.equal(publicBytes.includes(workspaceId), false);
  }
});

test("unknown, malformed, revoked, future, and expired sessions share one authentication denial before directory lookup", async () => {
  let directoryCalls = 0;
  const sessions = new DeterministicLocalIdentityProvider([
    ...SESSION_FIXTURES,
    sessionFixture({
      token: "token_future",
      userId: "user_future",
      email: "future@example.test",
      issuedAt: "2026-08-10T09:00:00.001Z",
      expiresAt: "2026-08-10T10:00:00.000Z",
    }),
  ]);
  const boundary = new AuthWorkspaceBoundary({
    sessions,
    directory: Object.freeze({
      async findWorkspaceAccess() {
        directoryCalls += 1;
        return accessRecord({});
      },
    }),
    clock: Object.freeze({ nowEpochMs: () => NOW }),
  });

  for (const sessionToken of [
    "unknown_token",
    " token_with_spaces ",
    "token_revoked_session",
    "token_expired",
    "token_future",
  ]) {
    assert.deepEqual(
      await boundary.authorizeWorkspace({ sessionToken, workspaceId: WORKSPACE_A }),
      AUTHENTICATION_DENIED,
    );
  }
  assert.equal(directoryCalls, 0);
});

test("runtime-shaped missing request fields and malformed provider sessions fail closed", async () => {
  const boundary = createBoundary();
  assert.deepEqual(
    await boundary.authorizeWorkspace({ workspaceId: WORKSPACE_A }),
    AUTHENTICATION_DENIED,
  );
  assert.deepEqual(
    await boundary.authorizeWorkspace({ sessionToken: "token_active" }),
    WORKSPACE_DENIED,
  );

  const malformedSessionBoundary = new AuthWorkspaceBoundary({
    sessions: Object.freeze({
      async findSession() {
        return {
          ...SESSION_FIXTURES[0].session,
          normalizedEmail: "NOT-NORMALIZED@EXAMPLE.TEST",
        };
      },
    }),
    directory: new DeterministicLocalAuthorizationDirectory(ACCESS_RECORDS),
    clock: Object.freeze({ nowEpochMs: () => NOW }),
  });
  assert.deepEqual(
    await malformedSessionBoundary.authorizeWorkspace({
      sessionToken: "token_active",
      workspaceId: WORKSPACE_A,
    }),
    AUTHENTICATION_DENIED,
  );
});

test("a directory cannot grant access with a mismatched identity or workspace record", async () => {
  const session = SESSION_FIXTURES[0];
  const mismatches = [
    accessRecord({ workspaceId: WORKSPACE_B }),
    accessRecord({ userId: "user_other", email: "other@example.test" }),
    accessRecord({ email: "different@example.test" }),
  ];

  for (const mismatched of mismatches) {
    const boundary = new AuthWorkspaceBoundary({
      sessions: new DeterministicLocalIdentityProvider([session]),
      directory: Object.freeze({
        async findWorkspaceAccess() {
          return mismatched;
        },
      }),
      clock: Object.freeze({ nowEpochMs: () => NOW }),
    });
    assert.deepEqual(
      await boundary.authorizeWorkspace({
        sessionToken: session.sessionToken,
        workspaceId: WORKSPACE_A,
      }),
      WORKSPACE_DENIED,
    );
  }
});

test("reviewer identity is session-derived and every client-supplied reviewer field is rejected", async () => {
  const boundary = createBoundary();
  const request = { sessionToken: "token_active", workspaceId: WORKSPACE_A };
  const allowed = await boundary.authorizeReviewerMutation(request, {
    project_id: "project_review",
    candidate_id: "candidate_review",
  });
  assert.deepEqual(plainJson(allowed), {
    ok: true,
    value: {
      authorization: {
        authorized: true,
        reason: "ACTIVE_MEMBER",
        principal: {
          sessionId: "session_user_active",
          userId: "user_active",
          normalizedEmail: "active@example.test",
          provider: "LOCAL",
        },
        workspace: {
          workspaceId: WORKSPACE_A,
          membershipId: "membership_workspace_auth_a_user_active",
          role: "MEMBER",
        },
      },
      reviewer: {
        reviewerUserId: "user_active",
        reviewerSessionId: "session_user_active",
      },
      sanitizedMutationPayload: {
        project_id: "project_review",
        candidate_id: "candidate_review",
      },
    },
  });

  for (const payload of [
    { reviewer_user_id: "user_attacker" },
    { reviewer_user_id: "user_active" },
    { reviewerUserId: "user_attacker" },
  ]) {
    assert.deepEqual(
      await boundary.authorizeReviewerMutation(request, payload),
      REVIEWER_FORBIDDEN,
    );
  }

  assert.deepEqual(
    await boundary.authorizeReviewerMutation(
      { sessionToken: "token_uninvited", workspaceId: WORKSPACE_A },
      { reviewer_user_id: "user_attacker" },
    ),
    WORKSPACE_DENIED,
  );
});

test("deterministic local adapters reject ambiguous tokens, sessions, emails, and relationships", () => {
  const active = SESSION_FIXTURES[0];
  assert.throws(
    () => new DeterministicLocalIdentityProvider([active, active]),
    /session tokens must be unique/,
  );
  assert.throws(
    () =>
      new DeterministicLocalIdentityProvider([
        active,
        { ...active, sessionToken: "different_token" },
      ]),
    /session IDs must be unique/,
  );
  assert.throws(
    () =>
      new DeterministicLocalIdentityProvider([
        sessionFixture({
          token: "mixed_case_email",
          userId: "user_mixed_email",
          email: "Mixed@Example.test",
        }),
      ]),
    /valid canonical fields/,
  );
  assert.throws(
    () =>
      new DeterministicLocalAuthorizationDirectory([
        {
          ...accessRecord({}),
          invitation: {
            ...accessRecord({}).invitation,
            workspaceId: WORKSPACE_B,
          },
        },
      ]),
    /fields and relationships/,
  );
});

test("session state is fetched and time-checked again after the authorization-directory await", async () => {
  const first = SESSION_FIXTURES[0].session;
  for (const changed of [
    { ...first, status: "REVOKED" },
    { ...first, userId: "user_changed_after_lookup", sessionId: "session_changed_after_lookup" },
  ]) {
    let sessionReads = 0;
    const boundary = new AuthWorkspaceBoundary({
      sessions: Object.freeze({
        async findSession() {
          sessionReads += 1;
          return sessionReads === 1 ? first : changed;
        },
      }),
      directory: Object.freeze({
        async findWorkspaceAccess() {
          return accessRecord({});
        },
      }),
      clock: Object.freeze({ nowEpochMs: () => NOW }),
    });
    assert.deepEqual(
      await boundary.authorizeWorkspace({
        sessionToken: "token_active",
        workspaceId: WORKSPACE_A,
      }),
      AUTHENTICATION_DENIED,
    );
    assert.equal(sessionReads, 2);
  }
});

test("malformed provider and directory rows deny without getters, throws, or role leakage", async () => {
  let getterCalls = 0;
  const accessorSession = { ...SESSION_FIXTURES[0].session };
  Object.defineProperty(accessorSession, "sessionId", {
    enumerable: true,
    get() {
      getterCalls += 1;
      return "session_accessor";
    },
  });
  const accessorBoundary = new AuthWorkspaceBoundary({
    sessions: Object.freeze({
      async findSession() {
        return accessorSession;
      },
    }),
    directory: Object.freeze({
      async findWorkspaceAccess() {
        throw new Error("directory must not be reached");
      },
    }),
    clock: Object.freeze({ nowEpochMs: () => NOW }),
  });
  assert.deepEqual(
    await accessorBoundary.authorizeWorkspace({
      sessionToken: "token_active",
      workspaceId: WORKSPACE_A,
    }),
    AUTHENTICATION_DENIED,
  );
  assert.equal(getterCalls, 0);

  for (const malformedAccess of [
    { ...accessRecord({}), unexpected: true },
    {
      ...accessRecord({}),
      membership: { ...accessRecord({}).membership, role: "OWNER" },
    },
    {
      ...accessRecord({}),
      membership: { ...accessRecord({}).membership, membershipId: "../unsafe" },
    },
  ]) {
    const boundary = new AuthWorkspaceBoundary({
      sessions: new DeterministicLocalIdentityProvider([SESSION_FIXTURES[0]]),
      directory: Object.freeze({
        async findWorkspaceAccess() {
          return malformedAccess;
        },
      }),
      clock: Object.freeze({ nowEpochMs: () => NOW }),
    });
    assert.deepEqual(
      await boundary.authorizeWorkspace({
        sessionToken: "token_active",
        workspaceId: WORKSPACE_A,
      }),
      WORKSPACE_DENIED,
    );
  }
});

test("Google admission exposes only active-identity durable invitation-membership transitions", async () => {
  for (const [identityStatus, invitationStatus, membershipStatus, expected] of [
    ["ACTIVE", "PENDING", "INVITED", "ACTIVATE_INVITATION"],
    ["ACTIVE", "ACCEPTED", "ACTIVE", "ALREADY_ACTIVE"],
    ["ACTIVE", "PENDING", "ACTIVE", null],
    ["ACTIVE", "ACCEPTED", "INVITED", null],
    ["ACTIVE", "ACCEPTED", "SUSPENDED", null],
    ["ACTIVE", "REVOKED", "ACTIVE", null],
    ["DISABLED", "ACCEPTED", "ACTIVE", null],
    ["LOCKED", "ACCEPTED", "ACTIVE", null],
    [undefined, "ACCEPTED", "ACTIVE", null],
  ]) {
    const boundary = new AuthWorkspaceBoundary({
      sessions: new DeterministicLocalIdentityProvider([]),
      directory: Object.freeze({
        async findSignInInvitation() {
          return {
            workspaceId: WORKSPACE_A,
            workspaceStatus: "ACTIVE",
            normalizedEmail: "person@example.test",
            identityStatus,
            invitationStatus,
            membershipStatus,
          };
        },
      }),
      clock: Object.freeze({ nowEpochMs: () => NOW }),
    });
    const result = await boundary.authorizeInvitedGoogleSignIn({
      workspaceId: WORKSPACE_A,
      email: "person@example.test",
      emailVerified: true,
    });
    if (expected === null) {
      assert.deepEqual(result, WORKSPACE_DENIED);
    } else {
      assert.equal(result.ok, true);
      assert.equal(result.value.materialization.mode, expected);
      assert.equal(result.value.materialization.expectedIdentityStatus, "ACTIVE");
      assert.equal(result.value.materialization.transactionRequired, true);
    }
  }
});

test("reviewer spoofing is rejected through nested, inherited, accessor, and cyclic payloads", async () => {
  const boundary = createBoundary();
  const request = { sessionToken: "token_active", workspaceId: WORKSPACE_A };
  const inherited = Object.create({ reviewer_user_id: "user_attacker" });
  const cyclic = {};
  cyclic.self = cyclic;
  let getterCalls = 0;
  const accessor = {};
  Object.defineProperty(accessor, "reviewerUserId", {
    enumerable: true,
    get() {
      getterCalls += 1;
      return "user_attacker";
    },
  });
  for (const payload of [
    { approval: { reviewer: { userId: "user_attacker" } } },
    { approval: { reviewer_session_id: "session_attacker" } },
    inherited,
    accessor,
    cyclic,
  ]) {
    assert.deepEqual(
      await boundary.authorizeReviewerMutation(request, payload),
      REVIEWER_FORBIDDEN,
    );
  }
  assert.equal(getterCalls, 0);
});

test("reviewer payload authorization returns only a bounded immutable plain-data snapshot", async () => {
  const boundary = createBoundary();
  const request = { sessionToken: "token_active", workspaceId: WORKSPACE_A };
  const payload = {
    project_id: "project_review",
    candidate: {
      approved: true,
      score: 0.75,
      tags: ["usable", "final"],
      note: null,
    },
  };
  const result = await boundary.authorizeReviewerMutation(request, payload);
  assert.equal(result.ok, true);
  assert.deepEqual(plainJson(result.value.sanitizedMutationPayload), payload);
  assert.notEqual(result.value.sanitizedMutationPayload, payload);
  assert.notEqual(result.value.sanitizedMutationPayload.candidate, payload.candidate);
  assert.notEqual(result.value.sanitizedMutationPayload.candidate.tags, payload.candidate.tags);
  assert.equal(Object.isFrozen(result.value.sanitizedMutationPayload), true);
  assert.equal(Object.isFrozen(result.value.sanitizedMutationPayload.candidate), true);
  assert.equal(Object.isFrozen(result.value.sanitizedMutationPayload.candidate.tags), true);

  payload.project_id = "project_changed_after_authorization";
  payload.candidate.tags[0] = "changed_after_authorization";
  payload.candidate.reviewer_user_id = "user_attacker";
  assert.deepEqual(plainJson(result.value.sanitizedMutationPayload), {
    project_id: "project_review",
    candidate: {
      approved: true,
      score: 0.75,
      tags: ["usable", "final"],
      note: null,
    },
  });
});

test("reviewer payload snapshots strip hidden Proxy state without late reads or mutation", async () => {
  const boundary = createBoundary();
  const request = { sessionToken: "token_active", workspaceId: WORKSPACE_A };
  let proxyGetCalls = 0;
  const proxyTarget = {
    project_id: "project_review",
    reviewer_user_id: "user_attacker",
  };
  const hiddenReviewerProxy = new Proxy(proxyTarget, {
    get(target, key, receiver) {
      proxyGetCalls += 1;
      return Reflect.get(target, key, receiver);
    },
    ownKeys() {
      return ["project_id"];
    },
    getOwnPropertyDescriptor(target, key) {
      return key === "project_id" ? Object.getOwnPropertyDescriptor(target, key) : undefined;
    },
  });

  const hiddenResult = await boundary.authorizeReviewerMutation(request, hiddenReviewerProxy);
  assert.equal(hiddenResult.ok, true);
  assert.deepEqual(plainJson(hiddenResult.value.sanitizedMutationPayload), {
    project_id: "project_review",
  });
  assert.notEqual(hiddenResult.value.sanitizedMutationPayload, hiddenReviewerProxy);
  assert.equal("reviewer_user_id" in hiddenResult.value.sanitizedMutationPayload, false);
  assert.equal(proxyGetCalls, 0, "proxy validation must not invoke attacker get traps");

  let lateGetterCalls = 0;
  let siblingGetCalls = 0;
  const inspectedFirst = { value: "captured_before_sibling" };
  const siblingTarget = { safe: "captured_sibling", reviewer_user_id: "user_attacker" };
  const statefulSibling = new Proxy(siblingTarget, {
    get(target, key, receiver) {
      siblingGetCalls += 1;
      return Reflect.get(target, key, receiver);
    },
    getPrototypeOf() {
      inspectedFirst.value = "mutated_after_capture";
      Object.defineProperty(inspectedFirst, "late", {
        enumerable: true,
        get() {
          lateGetterCalls += 1;
          return "must-not-run";
        },
      });
      return Object.prototype;
    },
    ownKeys() {
      return ["safe"];
    },
    getOwnPropertyDescriptor(target, key) {
      return key === "safe" ? Object.getOwnPropertyDescriptor(target, key) : undefined;
    },
  });
  const statefulResult = await boundary.authorizeReviewerMutation(request, {
    first: inspectedFirst,
    sibling: statefulSibling,
  });
  assert.equal(statefulResult.ok, true);
  assert.deepEqual(plainJson(statefulResult.value.sanitizedMutationPayload), {
    first: { value: "captured_before_sibling" },
    sibling: { safe: "captured_sibling" },
  });
  assert.equal(siblingGetCalls, 0);
  assert.equal(lateGetterCalls, 0);
  assert.equal("late" in statefulResult.value.sanitizedMutationPayload.first, false);
  assert.equal("reviewer_user_id" in statefulResult.value.sanitizedMutationPayload.sibling, false);
});

test("reviewer snapshots cannot inherit poisoned reviewer identities", async () => {
  const boundary = createBoundary();
  const request = { sessionToken: "token_active", workspaceId: WORKSPACE_A };
  const objectGrant = await boundary.authorizeReviewerMutation(request, {
    project_id: "project_review",
    groups: [["one"], ["two"]],
  });
  const arrayGrant = await boundary.authorizeReviewerMutation(request, [
    { project_id: "project_review" },
    ["nested"],
  ]);
  assert.equal(objectGrant.ok, true);
  assert.equal(arrayGrant.ok, true);

  const objectSnapshot = objectGrant.value.sanitizedMutationPayload;
  const rootArraySnapshot = arrayGrant.value.sanitizedMutationPayload;
  const nestedArraySnapshot = objectSnapshot.groups[0];
  assert.equal(Object.getPrototypeOf(objectSnapshot), null);
  assert.equal(Array.isArray(rootArraySnapshot), true);
  assert.equal(Array.isArray(nestedArraySnapshot), true);
  assert.equal(Object.getPrototypeOf(rootArraySnapshot), null);
  assert.equal(Object.getPrototypeOf(nestedArraySnapshot), null);

  const originalObjectReviewer = Object.getOwnPropertyDescriptor(
    Object.prototype,
    "reviewer_user_id",
  );
  const originalArrayReviewer = Object.getOwnPropertyDescriptor(
    Array.prototype,
    "reviewer_session_id",
  );
  let objectReviewerGetterCalls = 0;
  let arrayReviewerGetterCalls = 0;
  try {
    Object.defineProperty(Object.prototype, "reviewer_user_id", {
      configurable: true,
      get() {
        objectReviewerGetterCalls += 1;
        return "user_attacker";
      },
    });
    Object.defineProperty(Array.prototype, "reviewer_session_id", {
      configurable: true,
      get() {
        arrayReviewerGetterCalls += 1;
        return "session_attacker";
      },
    });

    assert.equal("reviewer_user_id" in objectSnapshot, false);
    assert.equal(objectSnapshot.reviewer_user_id, undefined);
    for (const snapshot of [rootArraySnapshot, nestedArraySnapshot]) {
      assert.equal("reviewer_session_id" in snapshot, false);
      assert.equal(snapshot.reviewer_session_id, undefined);
    }
  } finally {
    if (originalObjectReviewer === undefined) {
      delete Object.prototype.reviewer_user_id;
    } else {
      Object.defineProperty(Object.prototype, "reviewer_user_id", originalObjectReviewer);
    }
    if (originalArrayReviewer === undefined) {
      delete Array.prototype.reviewer_session_id;
    } else {
      Object.defineProperty(Array.prototype, "reviewer_session_id", originalArrayReviewer);
    }
  }
  assert.equal(objectReviewerGetterCalls, 0);
  assert.equal(arrayReviewerGetterCalls, 0);
});

test("reviewer snapshot size checks never invoke inherited toJSON", async () => {
  const boundary = createBoundary();
  const request = { sessionToken: "token_active", workspaceId: WORKSPACE_A };
  const originalToJson = Object.getOwnPropertyDescriptor(Object.prototype, "toJSON");
  let toJsonGetterCalls = 0;
  let result;
  try {
    Object.defineProperty(Object.prototype, "toJSON", {
      configurable: true,
      get() {
        toJsonGetterCalls += 1;
        return () => ({ reviewer_user_id: "user_attacker" });
      },
    });
    result = await boundary.authorizeReviewerMutation(request, {
      project_id: "project_review",
      candidate: { tags: ["ordinary", "json"] },
    });
  } finally {
    if (originalToJson === undefined) {
      delete Object.prototype.toJSON;
    } else {
      Object.defineProperty(Object.prototype, "toJSON", originalToJson);
    }
  }
  assert.equal(toJsonGetterCalls, 0);
  assert.equal(result.ok, true);
  assert.deepEqual(plainJson(result.value.sanitizedMutationPayload), {
    project_id: "project_review",
    candidate: { tags: ["ordinary", "json"] },
  });
});

test("reviewer payload validation rejects deterministic complexity and exotic shapes", async () => {
  const boundary = createBoundary();
  const request = { sessionToken: "token_active", workspaceId: WORKSPACE_A };

  const sparse = new Array(REVIEWER_MUTATION_PAYLOAD_LIMITS.maximumArrayLength * 10);
  sparse[0] = "present";
  const symbolPayload = { project_id: "project_review" };
  symbolPayload[Symbol("reviewer")] = "user_attacker";
  const customPrototype = Object.create({ harmless: true });
  customPrototype.project_id = "project_review";
  let tooDeep = { leaf: true };
  for (let depth = 0; depth <= REVIEWER_MUTATION_PAYLOAD_LIMITS.maximumDepth; depth += 1) {
    tooDeep = { child: tooDeep };
  }
  const tooManyProperties = {};
  for (let index = 0; index <= REVIEWER_MUTATION_PAYLOAD_LIMITS.maximumProperties; index += 1) {
    tooManyProperties[`field_${index}`] = index;
  }
  const encodedOversize = {
    note: "😀".repeat(REVIEWER_MUTATION_PAYLOAD_LIMITS.maximumStringUtf8Bytes / 2),
  };

  for (const payload of [
    sparse,
    symbolPayload,
    customPrototype,
    tooDeep,
    tooManyProperties,
    encodedOversize,
    { project_id: undefined },
    { project_id: 1n },
    { project_id: Number.NaN },
  ]) {
    assert.deepEqual(
      await boundary.authorizeReviewerMutation(request, payload),
      REVIEWER_FORBIDDEN,
    );
  }
});

test("local fixtures require exact own plain fields and complete safe identifiers and roles", () => {
  const active = SESSION_FIXTURES[0];
  assert.throws(
    () => new DeterministicLocalIdentityProvider([{ ...active, unexpected: true }]),
    /exact plain data/,
  );
  const inherited = Object.create(active);
  assert.throws(() => new DeterministicLocalIdentityProvider([inherited]), /exact plain data/);
  assert.throws(
    () =>
      new DeterministicLocalAuthorizationDirectory([
        {
          ...accessRecord({}),
          membership: { ...accessRecord({}).membership, role: "OWNER" },
        },
      ]),
    /exact valid fields/,
  );
  assert.throws(
    () =>
      new DeterministicLocalAuthorizationDirectory([
        {
          ...accessRecord({}),
          membership: { ...accessRecord({}).membership, membershipId: "../membership" },
        },
      ]),
    /exact valid fields/,
  );
});
