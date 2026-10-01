import { describe, expect, it, mock } from "bun:test";
import { screen, waitFor } from "@testing-library/react";
import { ConfirmProvider } from "../../../src/components/ui/ConfirmDialog.jsx";
import {
  RoomMentorsSection,
  RoomStudentsSection,
} from "../../../src/features/academic/components/pc-activity-room/RoomAssignmentsSection.jsx";
import {
  AddStudentsDialog,
} from "../../../src/features/academic/components/pc-activity-room/AssignmentDialogs.jsx";
import {
  assignmentDuration,
  humanizeAssignmentDuration,
} from "../../../src/features/academic/utils/assignmentDuration.js";
import { renderWithProviders } from "../../helpers/render.jsx";
import { createFetchRouter, jsonResponse } from "../../helpers/http.js";

const room = {
  id: "room-1",
  display_name: "Coding - A",
  academic_year_id: "year-1",
  start_date: "2026-07-01T00:00:00.000Z",
  student_count: 1,
  scheduled_count: 0,
  mentors: [],
};

const student = {
  id: "assignment-1",
  student_id: "student-1",
  student_name: "Ari Student",
  nis: "1001",
  class_name: "Grade 1A",
  status: "EXPIRED",
  start_date: "2026-07-01T00:00:00.000Z",
  expires_at: "2026-09-01T00:00:00.000Z",
  end_date: null,
  still_eligible: true,
};

function renderManaged(ui) {
  return renderWithProviders(<ConfirmProvider>{ui}</ConfirmProvider>);
}

describe("PC activity room detail assignments", () => {
  it("requests server pagination/search and exposes row and bulk actions", async () => {
    const fetchMock = createFetchRouter([
      {
        path: /^\/api\/admin\/pc-activity-rooms\/room-1\/students\?.*/,
        response: jsonResponse({
          data: [student],
          paging: { current_page: 1, total_page: 2, total_item: 11, size: 10 },
        }),
      },
    ]);
    globalThis.fetch = fetchMock;
    const { user } = renderManaged(
      <RoomStudentsSection room={room} canManage />,
    );

    expect(await screen.findByText("Ari Student")).toBeVisible();
    expect(screen.getAllByText("Expired")).toHaveLength(1);
    expect(screen.getByText("Expired 01 Sept 2026")).toBeVisible();
    expect(String(fetchMock.mock.calls[0][0])).toContain(
      "page=1&size=10&sort_by=start_date&sort_order=desc",
    );

    await user.click(screen.getByRole("button", { name: "Actions for Ari Student" }));
    expect(screen.getByRole("button", { name: /Edit start date/ })).toBeVisible();
    expect(screen.getByRole("button", { name: /^Move$/ })).toBeVisible();
    expect(screen.getByRole("button", { name: /Promote to next year/ })).toBeVisible();
    expect(screen.getByRole("button", { name: /^End$/ })).toBeVisible();
    expect(screen.getByRole("button", { name: /Drop \/ remove/ })).toBeVisible();

    await user.click(screen.getByRole("checkbox", { name: "Select Ari Student" }));
    await user.click(screen.getByRole("button", { name: "Bulk Actions" }));
    expect(screen.getByRole("button", { name: /Edit start date/ })).toBeVisible();

    await user.click(screen.getByPlaceholderText("Search students"));
    await user.keyboard("ari");
    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some(([url]) => String(url).includes("search=ari")),
      ).toBe(true),
    );
  });

  it("paginates candidates, retains selections, and submits the selected start date", async () => {
    const assign = mock(() => jsonResponse({ data: { success_count: 1, failed_count: 0 } }));
    const fetchMock = createFetchRouter([
      {
        path: /^\/api\/admin\/pc-activity-rooms\/room-1\/eligible-students\?.*/,
        response: ({ url }) =>
          jsonResponse({
            data: [
              {
                student_id: url.includes("page=2") ? "student-2" : "student-1",
                full_name: url.includes("page=2") ? "Budi Student" : "Ari Student",
                nis: "1001",
                grade_name: "Grade 1",
                class_name: "Grade 1A",
                other_activity: null,
              },
            ],
            paging: { current_page: url.includes("page=2") ? 2 : 1, total_page: 2, total_item: 2, size: 10 },
          }),
      },
      {
        path: "/api/admin/pc-activity-rooms/room-1/students/bulk",
        method: "POST",
        response: ({ options }) => assign(options),
      },
    ]);
    globalThis.fetch = fetchMock;
    const { user } = renderManaged(
      <AddStudentsDialog room={room} remainingSlots={99} onClose={() => {}} onAdded={() => {}} />,
    );

    await user.click(await screen.findByRole("checkbox", { name: "Ari Student" }));
    expect(String(fetchMock.mock.calls[0][0])).toContain("available_only=true");
    await user.click(screen.getByRole("button", { name: "Next" }));
    await user.click(await screen.findByRole("checkbox", { name: "Budi Student" }));
    expect(screen.getByText(/2 students selected across all pages/)).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Assign Students" }));

    await waitFor(() => expect(assign).toHaveBeenCalled());
    expect(JSON.parse(assign.mock.calls[0][0].body)).toEqual({
      student_ids: ["student-1", "student-2"],
      start_date: "2026-07-01T00:00:00.000Z",
    });
  });

  it("shows NIS, class and expiry as their own columns on one line per student", async () => {
    globalThis.fetch = createFetchRouter([
      {
        path: /^\/api\/admin\/pc-activity-rooms\/room-1\/students\?.*/,
        response: jsonResponse({
          data: [{ ...student, status: "ACTIVE", grade_name: "Grade 1", expires_at: "2026-12-01T00:00:00.000Z" }],
          paging: { current_page: 1, total_page: 1, total_item: 1, size: 10 },
        }),
      },
    ]);
    renderManaged(<RoomStudentsSection room={room} canManage />);
    await screen.findByText("Ari Student");

    for (const header of ["NIS", "Class", "Status", "Duration", "Expires"]) {
      expect(screen.getByRole("columnheader", { name: new RegExp(header) })).toBeVisible();
    }
    expect(screen.getByText("1001")).toBeVisible();
    expect(screen.getByText("Grade 1A")).toBeVisible();
    expect(screen.getByText("01 Dec 2026")).toBeVisible();
  });

  it("shows job position and unit for mentors", async () => {
    globalThis.fetch = createFetchRouter([
      {
        path: /^\/api\/admin\/pc-activity-rooms\/room-1\/mentors\?.*/,
        response: jsonResponse({
          data: [{
            id: "m-1",
            room_id: "room-1",
            mentor_id: "emp-1",
            mentor_name: "Rina Mentor",
            mentor_type: "EMPLOYEE",
            job_position_name: "Art Teacher",
            unit_name: "Elementary",
            status: "ACTIVE",
            start_date: "2026-07-01T00:00:00.000Z",
            end_date: null,
          }],
          paging: { current_page: 1, total_page: 1, total_item: 1, size: 10 },
        }),
      },
    ]);
    renderManaged(<RoomMentorsSection room={room} canManage />);
    expect(await screen.findByText("Rina Mentor")).toBeVisible();
    expect(screen.getByRole("columnheader", { name: /Job position/ })).toBeVisible();
    expect(screen.getByRole("columnheader", { name: "Unit" })).toBeVisible();
    expect(screen.getByText("Art Teacher")).toBeVisible();
    expect(screen.getByText("Elementary")).toBeVisible();
  });

  it("keeps the current page on screen while the next page loads", async () => {
    let releasePageTwo
    const pageTwo = new Promise((resolve) => { releasePageTwo = resolve })
    globalThis.fetch = createFetchRouter([
      {
        path: /^\/api\/admin\/pc-activity-rooms\/room-1\/students\?.*/,
        response: async ({ url }) => {
          if (url.includes("page=2")) await pageTwo
          return jsonResponse({
            data: [{ ...student, id: url.includes("page=2") ? "assignment-2" : "assignment-1", student_name: url.includes("page=2") ? "Budi Student" : "Ari Student" }],
            paging: { current_page: url.includes("page=2") ? 2 : 1, total_page: 2, total_item: 11, size: 10 },
          })
        },
      },
    ])
    const { user } = renderManaged(<RoomStudentsSection room={room} canManage />)
    expect(await screen.findByText("Ari Student")).toBeVisible()

    await user.click(screen.getByRole("button", { name: "Next" }))
    // Page two has not answered yet: page one rows stay, no Loading row replaces them.
    expect(screen.getByText("Ari Student")).toBeVisible()
    expect(screen.queryByText("Loading students...")).not.toBeInTheDocument()

    releasePageTwo()
    expect(await screen.findByText("Budi Student")).toBeVisible()
  });

  it("says where else a candidate already is, and when a legacy record gets attached", async () => {
    globalThis.fetch = createFetchRouter([
      {
        path: /^\/api\/admin\/pc-activity-rooms\/room-1\/eligible-students\?.*/,
        response: jsonResponse({
          data: [
            { student_id: "student-1", full_name: "Ari Student", nis: "1", grade_name: "Grade 1", class_name: "1A", other_activity: { activity_name: "Book Keepers", day: "TUESDAY", same_day: false }, legacy_match: "NONE" },
            { student_id: "student-2", full_name: "Budi Student", nis: "2", grade_name: "Grade 1", class_name: "1A", other_activity: { activity_name: "Coding", day: "MONDAY", same_day: true }, legacy_match: "EXACT" },
          ],
          paging: { current_page: 1, total_page: 1, total_item: 2, size: 10 },
        }),
      },
    ])
    renderManaged(<AddStudentsDialog room={room} remainingSlots={99} onClose={() => {}} onAdded={() => {}} />)
    expect(await screen.findByText("Also in Book Keepers (Tuesday)")).toBeVisible()
    expect(screen.getByText("Existing Coding record on Monday will be attached to this room")).toBeVisible()
  });

  it("formats assignment duration consistently", () => {
    expect(
      assignmentDuration(
        "2026-07-01T00:00:00.000Z",
        "2026-09-01T00:00:00.000Z",
      ),
    ).toBe("01 Jul 2026 - 01 Sept 2026");
    expect(
      humanizeAssignmentDuration(
        "2026-07-01T00:00:00.000Z",
        "2026-09-01T00:00:00.000Z",
      ),
    ).toBe("2 Months");
  });
});
