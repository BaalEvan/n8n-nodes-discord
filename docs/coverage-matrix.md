# Discord Coverage Matrix

Updated: 2026-05-12

Official index: https://docs.discord.com/llms.txt reviewed on 2026-05-11.

Status legend:

- `Current`: implemented in this repository.
- `Current partial`: partially implemented; some endpoints or polish pending.
- `Planned`: should be implemented for full Discord API coverage but not yet.
- `Boundary`: tracked; only REST-compatible / server-side n8n pieces are implemented. Non-REST surfaces (client SDKs, media transport, etc.) are explicitly out of scope.
- `Out of scope`: not planned for this n8n node.

## REST Resources

| Official docs page | Status | Current implementation | Planned next coverage | Boundary notes |
| --- | --- | --- | --- | --- |
| Application Resource | Current | Get current application, edit current application (collection of optional body fields), get activity instance | Guided UI for nested fields (install_params/integration_types_config) | Keep app management separate from OAuth2 setup docs. |
| Application Role Connection Metadata | Current | Get and update metadata records via raw JSON array body | Guided record builder | Needed for linked roles and user-authorized flows. |
| Audit Logs Resource | Current | Get guild audit log with 69 action_type options and before/after pagination | Cursor helper UX | Audit-log reason headers are handled by `shared/auditLog.ts`. |
| Auto Moderation | Current | Rule CRUD with guided trigger_metadata (per trigger_type), guided actions collection, comma-separated exempt arrays; raw JSON escape hatches preserved | None planned | Trigger metadata varies by trigger_type; guided UI gates fields accordingly. |
| Channels Resource | Current | Get/modify/delete channel; messages, reactions, pins, channel permissions, channel invites, group DM recipients, follow announcement, typing, full thread create/join/member/archive listings | Forum/media channel polish (applied_tags helper) | Message ops also mirrored in Message resource for ergonomics. |
| Emoji Resource | Current | Guild and application emoji CRUD using data-URI image input | Binary→data-URI helper | No multipart needed for Discord emoji. |
| Entitlement Resource | Current | List (filters collection), get, consume, create test, delete test | None planned | Monetization milestone complete at REST level. |
| Guild Resource | Current | Get/modify/delete guild, create guild, preview, channels and positions, active threads, bans CRUD, prune, integrations, widget, vanity URL, welcome screen, onboarding, voice state, member list/search | None planned | Audit-log reason wired on mutating operations. |
| Guild Scheduled Event | Current | List, create, get, modify, delete, listUsers; raw JSON for entity_metadata and recurrence_rule; data-URI image | Guided recurrence rule builder | Community milestone complete at REST level. |
| Guild Template Resource | Current | Get, list, create, modify, sync, delete templates plus create-guild-from-template | None planned | Audit-log reason wired where Discord supports it. |
| Invite Resource | Current | Get invite, delete invite | None planned | Channel- and guild-scoped invite creation lives in Channel/Guild resources. |
| Lobby Resource | Current | Full REST CRUD plus member ops and channel link/unlink | None planned | Social SDK / Activity runtime out of scope. |
| Message Resource | Current | Send, get, delete, list, edit, bulk delete, crosspost; send/edit accept embeds (guided), components (guided buttons/select/mentionable plus raw JSON), attachments (guided + multipart preSend), allowed_mentions (guided), flags, message_reference, nonce, tts | None planned | Underlying endpoints also reachable through Channel resource. |
| Poll Resource | Current | Get answer voters (paginated), end poll | None planned | Poll creation lives in Message create payload. |
| SKU Resource | Current | List application SKUs | None planned | SKUs are managed in the developer portal. |
| Soundboard Resource | Current | Send sound, list default sounds, guild sound CRUD (data-URI audio) | None planned | Gateway soundboard events also exposed. |
| Stage Instance Resource | Current | CRUD with privacy level and audit log reason | None planned | Community audio event management only; not voice media. |
| Sticker Resource | Current | Get sticker, list Nitro packs, guild sticker CRUD; multipart createGuildSticker via preSend hook with binary input | None planned | Multipart fork uses node:crypto-free `FormData` global. |
| Subscription Resource | Current | List for SKU, get for SKU | None planned | Monetization milestone complete at REST level. |
| User Resource | Current | Get current, get user, modify current, list current guilds, current guild member, leave guild, create DM, create group DM, connections, application role connection get/update | None planned | OAuth2-only ops annotated in operation descriptions. |
| Voice Resource | Current | List voice regions; get/modify voice states | None planned | Voice gateway, UDP, and media transport out of scope. |
| Webhook Resource | Current | Execute by URL, create, channel/guild lists, get/modify/delete (with-token variants), Slack/GitHub-compatible execute, message get/edit/delete; execute and editMessage accept guided embeds/components/attachments/allowed_mentions plus multipart preSend | None planned | Audit-log reason wired on non-token mutating ops. |

## Gateway and Events

| Area | Status | Current implementation | Planned next coverage | Boundary notes |
| --- | --- | --- | --- | --- |
| Gateway connection | Current | Fetch gateway URL, connect, identify, heartbeat, resume, reconnect, close, session state persistence; close-code mapping helper exposed (`closeCodes.ts`) | Shard options, presence options, integration tests | Protocol mechanics stay internal unless useful as workflow controls. |
| Gateway send events | Current | Identify, Resume, Heartbeat are internal; `Discord Gateway Command` action node exposes Update Presence (op 3), Update Voice State (op 4), Request Guild Members (op 8), Request Soundboard Sounds (op 31) via the active Trigger's connection | None planned | Voice state update may be REST-only; full voice media is boundary. |
| Core session events | Current | `READY`, `RESUMED`, `RECONNECT`, `INVALID_SESSION`, `RATE_LIMITED`, raw payload option, and any-event option | Diagnostics normalization | `HELLO` remains internal protocol handling. |
| Application command events | Current | `APPLICATION_COMMAND_PERMISSIONS_UPDATE` selectable with metadata | Payload normalization | |
| Auto moderation events | Current | Rule create/update/delete and action execution selectable with metadata | Payload normalization | |
| Channel/thread events | Current | Channel, pins, thread, webhook, and thread member/list sync events selectable with metadata | Payload normalization | |
| Entitlement events | Current | Create/update/delete selectable | Payload normalization | |
| Guild/member/role events | Current | Guild, audit log, ban, emoji/sticker/integration, member, role events selectable; privileged intent metadata on member events | Payload normalization | Privileged intent warnings surfaced. |
| Guild scheduled event events | Current | Create/update/delete/user add/user remove selectable | Payload normalization | |
| Integration/invite/message/reaction/poll events | Current | All selectable with metadata; MESSAGE_CONTENT privileged warning on message events | Payload normalization | |
| Interaction events | Current | `INTERACTION_CREATE` selectable; HTTP interaction trigger exists alongside Gateway path | Per-type normalization in trigger output | |
| Presence/typing/user/voice/stage/soundboard/subscription events | Current | Selectors, intent mapping, and privileged metadata on PRESENCE_UPDATE | Payload normalization and boundary docs | |
| Webhook Events over HTTP | Current | `Discord Webhook Event Trigger` receives Application Webhook Events with Ed25519 verification, PING handling, and an event-type filter | None planned | Reuses the same credential as HTTP interactions. |

## Interactions and Components

| Area | Status | Current implementation | Planned next coverage | Boundary notes |
| --- | --- | --- | --- | --- |
| Application Commands | Current | Global/guild list/create/get/edit/delete/bulk overwrite, guild command permissions get/update; localization (guided per-locale collection + raw JSON), contexts, integration types, default_member_permissions (guided multi-select + raw bitfield), dm_permission, nsfw, command type; guided `commandOptions` collection per Discord option type with min/max/choices/autocomplete/channel_types; raw JSON payload as escape hatch | None planned (nested sub-command/group options remain raw JSON) | |
| Receiving Interactions | Current | Gateway selector receives `INTERACTION_CREATE` | Per-type payload normalization | HTTP-only interaction reception (no bot) is out of scope as of 0.3.0; users without a bot can build a custom Webhook + Code-node flow. |
| Responding to Interactions | Current | Initial callback (types 4, 5, 6, 7, 8, 9, 12 with guided UI), original response get/edit/delete, followup create/get/edit/delete; guided embeds/components/attachments/allowed_mentions; multipart preSend | None planned | |
| Components | Current | Type union for all v2 components; guided UI builders for buttons (action row), string select, mentionable/user/role/channel select, modal text input, V2 text display, V2 separator, V2 media gallery, V2 file; action-row transformers; validators (max 5 rows, max 40 v2 components, max 10 media items, etc.); auto-OR of `IS_COMPONENTS_V2` flag (32768) when any v2 layout component is present | None planned. Section (9) and Container (17) remain raw-JSON-only due to nested-shape complexity | |
| Modals | Current | Modal response builder via `createTextInputComponentField` + `buildTextInputsActionRow`; raw JSON escape hatch | None planned | |

## Auth, Permissions, Rate Limits, and Topics

| Area | Status | Current implementation | Planned next coverage | Boundary notes |
| --- | --- | --- | --- | --- |
| OAuth2 | Current | OAuth2 credential with authorization/token URLs, scopes, refresh; `Discord` REST node has an `Authentication` selector toggling between `discordGatewayBotApi` and `discordGatewayOAuth2Api`; URL builders (bot install, authorize, token revocation) live in `docs/examples/oauth2-url-builders.md` as copy-pasteable Code-node snippets | None planned | User-token/self-bot automation remains unsupported. The dedicated `Discord OAuth2` node was removed in 0.3.0 (thin wrapper around `URLSearchParams`). |
| Permissions | Current | Permission constants, options, aggregation, checks; guided `defaultMemberPermissionsFlags` on application commands; guided `allowFlags`/`denyFlags` on Channel `editChannelPermissions`; raw bitfield strings preserved as escape hatches | None planned | Values aligned with official Permissions topic. |
| Rate Limits | Current partial | `shared/rateLimits.ts` parsers and helpers; n8n HTTP retry remains the runtime behavior | Optional custom retry on top of parsers if n8n's default proves insufficient | Custom throttling avoided unless required. |
| Opcodes and Status Codes | Current | Gateway opcode handling; close-code map (`closeCodes.ts`) covering 4000-4014 with reconnect flag | Wire close-code metadata into trigger diagnostics output | Mostly internal protocol support. |
| Threads | Current | Covered through Channel resource (create from message / without message / in forum, join, member ops, archived listings) | None planned | Dedicated Thread resource not needed. |
| Voice Connections | Boundary | Voice regions and REST voice-state operations | None | Full voice gateway and media transport out of scope. |
| Teams | Out of scope | None | Link docs from README if needed | Developer Portal/team management is not an automation API surface. |

## Platform, SDK, and Guide Pages

| Official docs area | Status | Current implementation | Planned next coverage | Boundary notes |
| --- | --- | --- | --- | --- |
| Bots and companion apps | Current | Bot credential, REST node, Gateway trigger, HTTP interaction trigger | More workflow examples | Guide page maps to REST resources and triggers. |
| Server and Channel Management | Current | Guild, Channel, User, Invite, Member, Role, AuditLog resources | None planned | Guide page maps to REST resources. |
| Webhooks platform page | Current | Webhook resource with full management and execute lifecycle | None planned | Guide page maps to Webhook Resource. |
| OAuth2 and Permissions platform page | Current | OAuth2 credential plus `shared/oauth2.ts` URL builders; Permissions topic covered by `shared/permissions.ts` | Surface URL builders as a Discord-node operation | Guide page maps to topics. |
| Premium Apps and Activities / Monetization | Current | SKU, Entitlement, Subscription, ApplicationRoleConnectionMetadata resources | Worked examples | Product docs map to monetization resources. |
| Activities / Embedded App SDK | Boundary | REST overlaps implemented: Application, SKU, Entitlement, Lobby, OAuth2 | None | Browser Embedded App SDK runtime out of scope. |
| Discord Social SDK | Boundary | Lobby resource and OAuth2 cover the REST overlaps | None | C++/Unity/Unreal SDK runtime out of scope. |
| RPC | Out of scope | None | Document local-client dependency | Local Discord client RPC is not suitable for n8n server runtime. |
| Rich Presence | Boundary | None | Document SDK/API overlap if it becomes relevant | Rich Presence is mainly SDK/client activity state. |
| Discovery, policies, design guidelines, tutorials, quick starts, community resources | Out of scope | None | Reference from README only when helpful | Not node operations unless they change API behavior. |
