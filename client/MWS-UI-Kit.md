# Frontend Instruction – Centralized User Database

## Objective

The frontend has already been built with a clean and maintainable project structure. The goal of this task is **not** to rebuild, remake, or restructure the application.

Instead, your task is to **improve the existing user interface and user experience** so that it fully aligns with the **MWS Design System** and provides a modern, clean, and professional administrative dashboard.

---

# Important Rules

## DO NOT

- Rebuild the frontend from scratch.
- Change the existing folder structure.
- Move files between folders.
- Merge multiple components into a single file (e.g. App.jsx).
- Rewrite business logic unless necessary.
- Change routing structure.
- Change API layer.
- Change state management.
- Change feature architecture.
- Introduce unnecessary dependencies.

The existing architecture is already clean and should be preserved.

---

## DO

Improve only the presentation layer.

You may update:

- Layout
- Styling
- Typography
- Colors
- Component appearance
- Navigation
- Visual hierarchy
- User experience
- Responsive layout
- Accessibility
- Consistency

Whenever possible, modify the existing components instead of replacing them.

If a new reusable component is needed, place it inside the appropriate existing folder such as:

- `src/components/ui`
- `src/components/layout`

Do not create a new architecture.

---

# MWS Design Principles

The interface should feel:

- Clean
- Calm
- Spacious
- Warm
- Professional
- Human-centered
- Modern
- Easy to scan
- Consistent

Every screen should communicate information clearly with minimal cognitive load.

---

# Color System

## Primary Colors

| Color | Hex | Usage |
|--------|------|------|
| Burgundy | #7E1518 | Brand identity, primary actions, active navigation, page titles |
| White | #FFFFFF | Main surfaces and backgrounds |
| Gold | #D6A13A | Highlights and important achievements only |
| Charcoal | #241718 | Primary text color |

## Secondary Colors

| Color | Hex | Usage |
|--------|------|------|
| Rose | #B94A4E | Compassion, wellbeing, attention |
| Sage | #6F8B6A | Success, growth, positive status |
| Navy | #1F2A44 | Reports, analytics, data-heavy sections |
| Sky | #B8DDF8 | Calm informational sections |

## Color Guidelines

Always:

- Use Burgundy as the visual identity.
- Use White generously.
- Use Charcoal for readable text.
- Use only one secondary color per section whenever possible.
- Use Gold sparingly.

Never:

- Make entire pages Burgundy.
- Mix secondary colors randomly.
- Use neon colors.
- Use purple as the main color.
- Use pure black for large areas.
- Use flashy gold effects.

---

# Typography

Only use these font families.

## Plus Jakarta Sans

Use for:

- Hero headline
- Page title
- Section heading
- Buttons
- Labels

Weight:

- SemiBold
- Bold
- ExtraBold

---

## Nunito Sans

Use for:

- Body text
- Description
- Form labels
- Tables
- Helper text

Weight:

- Regular
- SemiBold

---

## Lora

Use only for quotes when necessary.

Weight:

- Medium Italic

---

## Typography Rules

- Use sentence case.
- Avoid ALL CAPS.
- Maintain generous line height.
- Do not introduce additional font families.

---

# Layout

The layout should feel:

- Clean
- Spacious
- Warm
- Easy to understand

Use:

- Rounded cards
- Soft borders
- Consistent spacing
- Clear sections
- Simple icons
- Clear hierarchy
- Plenty of whitespace

Avoid:

- Crowded dashboards
- Too many widgets above the fold
- Harsh shadows
- Dense forms
- Decorative graphics
- Large dark sections

Recommended border radius:

| Component | Radius |
|-----------|--------|
| Inputs | 8–12px |
| Tags | 8–12px |
| Buttons | Pill (999px) |
| Cards | 16–24px |
| Hero Panels | 24–32px |

---

# Components

Improve the appearance of existing components while preserving their responsibilities.

Apply the design system consistently to:

- Sidebar
- Top Navigation
- Cards
- Tables
- Forms
- Buttons
- Badges
- Pagination
- Search
- Filters
- Dialogs
- Empty States
- Loading States
- Profile Section

Do not redesign every page differently.

Maintain visual consistency throughout the application.

---

# Buttons

Use buttons consistently.

Primary

- Burgundy
- Main action

Outline

- Secondary action

Ghost

- Cancel
- Navigation
- Low emphasis

Gold

- Important highlight only

Never use Gold as the default primary button.

---

# Cards

Each card should have:

- Clear title
- Short description (optional)
- Clear purpose
- One primary action

Avoid mixing unrelated information inside one card.

---

# Status Badges

Use supportive wording.

Good:

- Active
- Growing
- Completed
- Evidence Ready
- Guided Support

Avoid:

- Failed
- Problem Student
- Low Performer
- Bad Behavior

---

# Copywriting

The interface should sound:

- Warm
- Professional
- Clear
- Respectful
- Encouraging

Avoid:

- Punishment
- Fear
- Shame
- Aggressive wording
- Elitist language

Good:

> Please enter a valid school email address.

Avoid:

> Invalid input.

Loading:

Good:

> Preparing your dashboard...

Avoid:

> Loading...

Empty State:

Good:

> New activity will appear here once data becomes available.

Avoid:

> No records.

---

# Dashboard Style

This is an **internal administrative dashboard**, not a marketing website.

Prioritize:

- User management
- Data management
- Reports
- Tables
- Search
- Filtering
- CRUD workflows
- Fast navigation

The overall appearance should resemble a modern SaaS Admin Dashboard while preserving the MWS visual identity.

---

# Visual Restrictions

Do NOT use:

- Animations
- Glassmorphism
- Neumorphism
- Heavy gradients
- Decorative illustrations
- Floating decorative elements
- Confetti
- Fancy transitions
- Excessive shadows

Keep interactions simple, responsive, and professional.

---

# Final Goal

This task is **not** about creating a new frontend.

This task is about **upgrading the existing frontend** by improving its UI and UX while preserving the current architecture.

Keep the existing:

- folder structure
- feature modules
- routing
- reusable components
- API layer
- clean code architecture

Only modernize the presentation layer so the application fully reflects the MWS Design System.

The final result should feel like a polished, enterprise-grade MWS administrative dashboard without sacrificing maintainability or code organization.