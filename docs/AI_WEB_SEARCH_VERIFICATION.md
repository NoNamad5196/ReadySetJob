# Responses API web search verification

Verified against official OpenAI documentation on 2026-11-12:

- https://platform.openai.com/docs/guides/tools-web-search
- https://developers.openai.com/api/docs/guides/structured-outputs
- https://developers.openai.com/api/docs/guides/migrate-to-responses

## Request and response

The current hosted search tool is `tools: [{ type: "web_search" }]` on
`POST https://api.openai.com/v1/responses`, authenticated with an Authorization
Bearer header. It is not the legacy `web_search_preview` or a client-side search.
Search responses contain `web_search_call` output items and assistant `message`
items. Text is in `message.content[].text`; cited sources are in the text
part's `annotations[]`, with `type: "url_citation"`, `url`, `title`,
`start_index`, and `end_index`. Output array positions must not be assumed.
Sources must remain visible as clickable links in the UI.

Responses Structured Outputs uses `text.format` with `type: "json_schema"`,
`name`, `schema`, and `strict: true` (not Chat Completions' `response_format`).
The fetched guides document tools and text formatting as Responses capabilities
and do not state that `web_search` prohibits JSON schema output. They do not,
however, provide an explicit combined example for the configured search model.
The implementation sends both, also explicitly requests a JSON object in the
instructions, and parses defensively before applying server-side validation.
This is documentation verification, not a claim that a live request has been
tested: no real OpenAI requests were made, and model/account compatibility must
be checked in deployment. API errors are surfaced rather than replaced with
fabricated job results.

## Application safeguards

Only search conditions are sent to public web search; private briefing context
is sent separately, without a search tool. Search results require a non-empty
HTTP(S) source URL. Invalid calendar dates become `null`, unknown employment
types remain `unknown` in the search response and are mapped to `other` only in
the existing job-registration form. Results are not saved until the user
explicitly submits that form with CSRF protection.

The requested defaults are `gpt-6.1-terra` for search and `gpt-6-luna` for
briefing, each with low reasoning effort. Feature-specific environment variables
are subordinate to the global `OPENAI_MODEL` override. These deployment model
names are project requirements, not a claim about universal model availability.
