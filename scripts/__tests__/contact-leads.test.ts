import { assertDeepEqual, assertEqual, defineSuite } from "./_assert";
import {
  contactLeadsFromMetadata,
  extractContactLeadCandidates,
  extractEmails,
  extractLinks,
  preferredContactEmail,
  preferredContactUrl,
  primaryContactLead,
} from "../../src/lib/sales/contact-leads";

const t = defineSuite("contact-leads");

t.test("extractEmails dedupes and normalizes addresses", () => {
  assertDeepEqual(extractEmails("Sales@Brand.com, sales@brand.com."), [
    "sales@brand.com",
  ]);
});

t.test("extractLinks resolves relative links and mailto links", () => {
  const links = extractLinks(
    '<a href="/contact">Contact</a><a href="mailto:hello@example.test">Email</a>',
    "https://brand.example/products/item"
  );

  assertEqual(links[0].url, "https://brand.example/contact");
  assertEqual(links[0].label, "Contact");
  assertEqual(links[1].url, "mailto:hello@example.test");
});

t.test("extractContactLeadCandidates ranks direct contacts first", () => {
  const leads = extractContactLeadCandidates(
    [
      "Reach us at wholesale@brand.example",
      '<a href="https://instagram.com/brand">Instagram</a>',
      '<a href="https://www.kickstarter.com/projects/brand/item">Kickstarter campaign</a>',
      '<a href="https://brand.example/contact">Contact</a>',
    ].join("\n"),
    "https://article.example/story"
  );

  assertEqual(leads[0].kind, "email");
  assertEqual(leads[0].value, "wholesale@brand.example");
  assertEqual(leads.some((lead) => lead.kind === "crowdfunding"), true);
  assertEqual(leads.some((lead) => lead.kind === "social"), true);
  assertEqual(leads.some((lead) => lead.kind === "contact_page"), true);
});

t.test("extractContactLeadCandidates skips aggregator chrome links", () => {
  const leads = extractContactLeadCandidates(
    [
      '<a href="https://www.kickstarter.com/profile/realmaker">Creator profile</a>',
      '<a href="https://twitter.com/kicktraq">Kicktraq X</a>',
      '<a href="https://www.kicktraq.com/contact/">Kicktraq Contact</a>',
    ].join("\n"),
    "https://www.kicktraq.com/projects/realmaker/item/"
  );

  assertEqual(leads.length, 1);
  assertEqual(leads[0].kind, "crowdfunding");
  assertEqual(leads[0].value, "https://www.kickstarter.com/profile/realmaker");
});

t.test("contactLeadsFromMetadata extracts synced contact candidates", () => {
  const snapshot = contactLeadsFromMetadata({
    contactLeads: {
      fetchedAt: "2026-06-19T00:00:00.000Z",
      sourceUrl: "https://example.test/story",
      fetchStatus: "ok:200",
      candidates: [
        {
          kind: "email",
          value: "hello@brand.example",
          label: "hello@brand.example",
          score: 100,
        },
        {
          kind: "crowdfunding",
          value: "https://www.kickstarter.com/profile/brand",
          label: "Creator",
          score: 88,
        },
      ],
    },
  });

  assertEqual(snapshot?.fetchStatus, "ok:200");
  assertEqual(primaryContactLead(snapshot)?.value, "hello@brand.example");
  assertEqual(preferredContactEmail(snapshot), "hello@brand.example");
  assertEqual(
    preferredContactUrl(snapshot),
    "https://www.kickstarter.com/profile/brand"
  );
});

export const contactLeads = t;
