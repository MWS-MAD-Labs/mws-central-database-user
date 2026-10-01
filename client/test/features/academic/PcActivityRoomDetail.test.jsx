import { describe, expect, it, mock } from "bun:test";
import { screen, waitFor } from "@testing-library/react";
import { ConfirmProvider } from "../../../src/components/ui/ConfirmDialog.jsx";
import {
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
