# Linear Design System (Dark Mode)

A design system rebuilt from the community Figma file **"Linear Design System (Community).fig"** — a dark-mode recreation of the Linear issue-tracker UI. The file is the sole source of truth: every value here (colours, 13px body type, 4px radii, inset-shadow borders) is transcribed from it, not from Linear's public site.

## Source

- Figma file: `Linear Design System (Community).fig` (attached to this project as a mounted virtual filesystem). Pages: **Design System – Dark Mode** (20 sections: Buttons, Colour Palette, Command Bar, Filters, Icons 16/24/Other, Input Fields, Issue Page, Issues, Keys, Logo, Navigation Sidebar, New Issue, Shadows, Text Edit, Toggle/Checkbox, Tooltips, Typography), **App Screens** (14 full frames), **Thumbnail**, **To-Do** (author's screenshots — not design content).
- The file defines 106 component sets + 229 standalone symbols (205 of them icons), no Figma Variables and no shared text styles: tokens below were derived from the palette, typography and shadow sections.
- The author's annotation in the palette frame: the many grey shades are intentional "with a purple hue" and could be consolidated.

## Product context

One product: the **Linear web/desktop app** — an issue tracker for software teams. Surfaces covered: issues list (list/board toggle, filters, view options), issue page (title, description, sub-issues, activity log, comments, right-hand properties sidebar), New Issue modal/page (status, priority, assignee, labels, due date, sub-issues, attachments), command bar (⌘K), filter dropdowns, and the persistent 220px sidebar (workspace, teams, inbox, my issues, views, roadmaps).

## Content fundamentals

- **Voice**: terse, functional, lowercase-friendly. Labels are single nouns or short verb phrases: "New issue", "Filter", "View", "Set due date…", "Convert to project", "Remind me about this issue…".
- **Casing**: sentence case everywhere ("My issues", "Help & Support" is the lone title-cased exception, copied verbatim). Status names are capitalised nouns: Backlog, Todo, In Progress, Done, Canceled (US spelling).
- **Person**: the UI addresses the user as "you"/"me" ("My issues", "Assign to me", "Remind me…"); the system speaks in the third person in activity logs ("decio created the issue.", "decio changed status from Todo to In Progress").
- **Ellipses** mark actions that open a further step: "Type a command or search…", "Create new project…".
- **Identifiers**: `TEAM-N` (e.g. `MY-12`) in 12px tertiary text; relative timestamps ("6 days ago", "12 Mar").
- **Emoji**: appears only inside user content (the sample issue "Welcome to Linear 👋"); never in chrome.
- **Keyboard shortcuts** are first-class copy — shown as key caps (⌘ K, Ctrl L, S) beside commands.

## Visual foundations

- **Palette**: near-black purple-tinted greys. App canvas `#181921`, sidebar `#191a23`, elevated surfaces `#1d1e2b`/`#292a35`, hover `#2c2d42`, borders `#2c2d3c` (strong `#393a4b`). Text `#eeeffc` primary, `#d2d3e0` secondary, `#858699` tertiary. Brand purple `#575bc7` (primary button), `#6c79ff` link/highlight. Decoration hues for labels/statuses only: red `#eb5757` bug, violet `#bb87fc` feature, blue `#4ea7fc` improvement, yellow `#f2c94c` in-progress, orange `#f2994a` urgent, green `#4cb782`.
- **Type**: Inter only, Regular 400 and Medium 500. 13px is the body size for rows, menus and buttons; 12px for meta/section headers; 11px for key caps; 15px for larger buttons and modal inputs; 18–24px headings; 36px display. Line-height 100% almost everywhere (buttons at 15px use 22px).
- **Spacing**: tight — 4/8/12/16px gaps, 14px horizontal button padding, 8px vertical, 24px content padding in modals, 60px in the issue page body. Rows are 44px (list) and 36px (sub-issues); sidebar items ~27px.
- **Radii**: 4px on buttons, inputs, menu items and chips; 5px on panels; 8px on cards/modals; 12px on documentation frames; circles for avatars and status glyphs.
- **Borders**: drawn as `inset 0 0 0 1px` box-shadows (so they don't affect layout), usually combined with a 1px drop shadow (`0 1px 1px rgba(0,0,0,.15)`). Dividers are 0.5–1px `#2c2d3c`; the sidebar has a 1px right border.
- **Shadows**: seven steps (`--shadow-xs` … `--shadow-2xl`) from `0 1px 1px .15` to `0 16px 70px .5`; dropdowns use lg/xl, modals 2xl. An error glow `0 0 12px -1px #eb5757` exists. The logo carries a purple-tinted glow.
- **Backgrounds**: flat fills only — no imagery, patterns or gradients in product UI. Modal scrim is `rgba(29,30,43,.498)` over `#202128`; two subtle diagonal scrims exist for overlays.
- **Hover**: background lightens one step (`#292a35 → #2c2d42`, border `#393a4b → #444556`) or gains a translucent wash `rgba(133,134,152,.2)`; text brightens from secondary to primary. **Selected** rows use `#393a4b`/`rgba(133,134,152,.2)`. **Focus** rings are 1px inset `#5e6ad2`. **Disabled** primary buttons drop to `#37466c` with muted text. No press/scale effects are defined.
- **Animation**: none defined in the file; assume instant state changes, at most short opacity fades.
- **Transparency & blur**: translucent fills for hover/dividers; no backdrop blur.
- **Imagery**: only user avatars (a single 21×-reused JPEG) — circular, 16/24px, optional status dot.
- **Layout**: fixed 220px left sidebar, 56px top bar, optional 340px right properties sidebar; content is full-bleed dark with hairline dividers, no cards.

## Iconography

- Custom 16px filled glyph set drawn in the file — 205 icons (navigation, statuses, priorities, calendars, editor tools, integrations, plus a large decorative set: faces, animals, places, currencies). Sizes used: 14, 16 and 24px. Single colour, painted with `currentColor`, typically `#858699` idle and `#d2d3e0`/`#eeeffc` on hover/selected.
- Shipped as `components/icons/icon-data.js` (name → SVG path data) with the `Icon` wrapper: `<Icon name="Issues" size={16} />`. Names are listed in `components/icons/Icon.d.ts`. Icons that back components also exist as standalone components (e.g. `Plus`, `Close`, `ChevronDown`).
- Status glyphs are icons (`Circle`, `Loader`, `Check2`, `AutoClosed`); priority is a bar-chart glyph (`Priority`); labels are 9/11px coloured dots (`LabelDots`).
- No icon font, no emoji in chrome. Unicode is used only for key caps (⌘, ↑, ?).
- Brand: the Linear logo mark (`LinearLogo` component, `guidelines/brand-mark.html`) and the wordmark (`assets/wordmark.svg`) come from the file's Logo and Thumbnail pages.

## Files

- `styles.css` — global entry; imports `tokens/fonts.css`, `tokens/colors.css`, `tokens/typography.css`, `tokens/spacing.css`, `tokens/shadows.css`, `components/fig-assets.css`.
- `tokens/` — CSS custom properties (base scales + semantic aliases).
- `guidelines/` — foundation specimen cards (Colors, Type, Elevation, Spacing, Brand, Icons) and `props-index.txt`, a one-line-per-component props summary.
- `components/` — every kit family as `<Name>.jsx` + `.d.ts` + `.prompt.md`, with specimen cards `*.card.html`; `components/icons/` holds the icon data and `Icon` wrapper.
- `ui_kits/app/` — click-through recreation of the App Screens (`index.html`, `Components.bundle.js`, `README.md`).
- `assets/wordmark.svg` — Linear wordmark from the Thumbnail page.
- `thumbnail.html`, `SKILL.md`.

## Components

Family components (from the Figma sets): ActivityHeader, ActivityLogs, ActivitySubscriber, AddButton, AddSubIssueButton, Annotations, AssignDropdown, Assignee, AssigneeDropdownOptions, AttachButton, Attachment, Avatar, AvatarButton, BottomMenuButtons, Buttons, CancelSubIssueButton, ChangeDateDropdown, Checkbox, CloseButton, CommandBar, CommentInput, CommentSubsection, CreateMore, DescriptionInput, DisplayPropertiesButtons, DragButton, DropdownFilterOptions, DropdownIcon, DropdownOptions, DropdownOptionsCheckboxes, DropdownSearch, EditableIssueTitle, ExpandButton, FilterButton, FilterDropdown, FilterSearch, GoToAssigneeButton, InputAddDescription, InputDropdown, InputField, InputFieldWithLink, InputIssueTitle, IssueAssigneeButton, IssueAssigneeSelector, IssueBranchButton, IssueCheckbox, IssueClipboardButton, IssueCloseButton, IssueDateButton, IssueHeader, IssueLabelButton, IssueLabelSelector, IssueLabels, IssueLinkButton, IssueMoreButton, IssueMoreButton2, IssueNavigationBar, IssueNumber, IssueParent, IssuePriorityButton, IssuePrioritySelector, IssueRightSidebar, IssueStar, IssueStatusButton, IssueStatusSelector, IssueTitle, IssueURLButton, IssuesFilterButton, IssuesFilterDropdown, IssuesFilterOptions, IssuesHeader, Key, LabelDots, LabelDotsCombinations, LabelDropdownOptions, LabelsDropdown, LabelsGroupSubIssue, LabelsSubIssue, LinearLogo, LinkDeleteButton, LinkEditor, ListAndBoardViewButtons, ListIssue, MenuButtons, MonochromeIcon, MoreDropdown, MoreDropdownOptions, NavigateIssuesArrows, NewIssue, NewIssueButton, OGImage, Priority, PriorityDropdown, PriorityDropdownOptions, ProgressWheel, Rows, SearchBox, SearchButton, SetAndResetButtons, SidebarBanner, SidebarMenu, SimpleDropdown, SimpleDropdown2, StarButton, StatusDropdown, StatusDropdownOptions, SubIssueAddButton, SubIssueCloseButton, SubIssueCollapsed, SubIssueInPage, SubIssueMoreButton, SubIssueStatusButton, SubIssuesHeader, SubIssuesMoreButton, Subtitle, TagsDropdown, TeamDropdown, TeamDropdownOption, TeamTag, TeamsMenuButtons, TextEditorButtons, Toggle, Tooltips, TopBar, URL, URLCloseButton, ViewDropdown, ViewFilterButton, WorkspaceButton, WorkspaceButtons, WorkspaceIcon.

Icon glyphs also exposed as components (dependencies of the families above): AddSubIssue, Alert, AllItems, Archive, Attachment2, AutoClosed, BlockedIssues, BlockingIssues, Board, Bold, Book, Branch, BulletPoint, CalendarBlock, CalendarEdit, CalendarEmpty, CalendarOverdue, CalendarPlus, CalendarUpdate, Check, Check2, Check2_, Checklist, ChevronDown, ChevronDown2, Circle, Clipboard, Close, Code, CodeBlock, Document, Edit, Edit2, Expand, Filters, Inbox, Issues, Issues2, Issues3, IssuesReferences, Italic, Label, Layers, Layout, Link, Links, Loader, Map, MoveMenu, Network, NumberedList, ParentIssue, Plus, Priority2, Quote, Search1, Search2, StarFilled, StarOutline, Status1, Status2, Strikethrough, SubIssues, Text, ThreeDots, Trash, Triangle, Twitter, TwoFlags, UserCircle, UserEdit, ViewList, WarningSquare.

Icon wrapper: Icon (components/icons).

### Intentional additions
- `Icon` — wrapper over the 205-glyph icon-data map so the whole set ships as one file.

### Caveats
- Inter is loaded from Google Fonts (no binaries in the .fig).
- Variant props keep Figma's naming (`state="hover"` renders the hover art; components are static, not stateful).
- Four white fills that are hidden in Figma but exported (TopBar, IssuesHeader, ActivityLogs timeline wrapper, IssueRightSidebar "new issue" variant) were set to transparent / app background.
- `Tooltips`/`Key` "Arrow Up" variants and two `IssueStatusButton` "In Progress" states collide on variant keys and are unreachable; `Shortcut` icon lost its mask.
