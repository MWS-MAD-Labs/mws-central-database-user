import type { Context } from "hono";
import type { AdminVariables } from "../../type/hono-context";
import type {
  AssignPcActivityRoomMentorRequest,
  BulkAssignPcActivityRoomMentorsRequest,
  BulkAssignPcActivityRoomStudentsRequest,
  BulkEndPcActivityRoomMentorAssignmentsRequest,
  BulkEndPcActivityRoomStudentAssignmentsRequest,
  BulkDropPcActivityRoomStudentAssignmentsRequest,
  BulkMovePcActivityRoomMentorAssignmentsRequest,
  BulkMovePcActivityRoomStudentAssignmentsRequest,
  BulkRemovePcActivityRoomMentorAssignmentsRequest,
  BulkReopenPcActivityRoomMentorAssignmentsRequest,
  BulkReopenPcActivityRoomStudentAssignmentsRequest,
  CreatePcActivityRoomRequest,
  UpdatePcActivityRoomRequest,
} from "../../model/pc-activity-room-model";
import { PCActivityRoomService } from "../../service/pc-activity-room-service";
import { ResponseError } from "../../error/response-error";
import { getAuditRequestContext } from "../../utils/audit-request-context";

export class PCActivityRoomController {
  static async search(c: Context<{ Variables: AdminVariables }>) {
    const admin = c.var.admin;
    const query = c.req.query();
    const response = await PCActivityRoomService.search(admin, {
      page: query.page ? Number(query.page) : 1,
      size: query.size ? Number(query.size) : 10,
      search: query.search,
      activity_id: query.activity_id,
      academic_year_id: query.academic_year_id,
      sort_by: query.sort_by as never,
      sort_order: query.sort_order as never,
    });
    return c.json(response);
  }

  static async get(c: Context<{ Variables: AdminVariables }>) {
    const admin = c.var.admin;
    const id = c.req.param("id");
    if (!id) throw new ResponseError(400, "Room ID is required in parameter");
    const response = await PCActivityRoomService.get(admin, { id });
    return c.json({ data: response });
  }

  static async create(c: Context<{ Variables: AdminVariables }>) {
    const admin = c.var.admin;
    const body = (await c.req.json()) as CreatePcActivityRoomRequest;
    const response = await PCActivityRoomService.create(
      admin,
      body,
      getAuditRequestContext(c),
    );
    return c.json({ data: response });
  }

  static async update(c: Context<{ Variables: AdminVariables }>) {
    const admin = c.var.admin;
    const id = c.req.param("id");
    if (!id) throw new ResponseError(400, "Room ID is required in parameter");
    const body = (await c.req.json()) as UpdatePcActivityRoomRequest;
    const response = await PCActivityRoomService.update(
      admin,
      { ...body, id },
      getAuditRequestContext(c),
    );
    return c.json({ data: response });
  }

  static async remove(c: Context<{ Variables: AdminVariables }>) {
    const admin = c.var.admin;
    const id = c.req.param("id");
    if (!id) throw new ResponseError(400, "Room ID is required in parameter");
    await PCActivityRoomService.remove(
      admin,
      { id },
      getAuditRequestContext(c),
    );
    return c.json({ data: null });
  }

  static async listMentors(c: Context<{ Variables: AdminVariables }>) {
    const admin = c.var.admin;
    const roomId = c.req.param("id");
    if (!roomId) throw new ResponseError(400, "Room ID is required in parameter");
    const response = await PCActivityRoomService.listMentors(admin, { room_id: roomId });
    return c.json({ data: response });
  }

  static async assignMentor(c: Context<{ Variables: AdminVariables }>) {
    const admin = c.var.admin;
    const roomId = c.req.param("id");
    if (!roomId) throw new ResponseError(400, "Room ID is required in parameter");
    const body = (await c.req.json()) as AssignPcActivityRoomMentorRequest;
    const response = await PCActivityRoomService.assignMentor(
      admin,
      { ...body, room_id: roomId },
      getAuditRequestContext(c),
    );
    return c.json({ data: response });
  }

  static async bulkAssignMentors(c: Context<{ Variables: AdminVariables }>) {
    const admin = c.var.admin;
    const roomId = c.req.param("id");
    if (!roomId) throw new ResponseError(400, "Room ID is required in parameter");
    const body = (await c.req.json()) as BulkAssignPcActivityRoomMentorsRequest;
    const response = await PCActivityRoomService.bulkAssignMentors(
      admin,
      { ...body, room_id: roomId },
      getAuditRequestContext(c),
    );
    return c.json({ data: response });
  }

  static async endMentorAssignment(c: Context<{ Variables: AdminVariables }>) {
    const admin = c.var.admin;
    const roomId = c.req.param("id");
    const assignmentId = c.req.param("assignmentId");
    if (!roomId || !assignmentId) {
      throw new ResponseError(400, "Room ID and assignment ID are required in parameter");
    }
    const response = await PCActivityRoomService.endMentorAssignment(
      admin,
      { id: assignmentId, room_id: roomId },
      getAuditRequestContext(c),
    );
    return c.json({ data: response });
  }

  static async removeMentorAssignment(c: Context<{ Variables: AdminVariables }>) {
    const admin = c.var.admin;
    const roomId = c.req.param("id");
    const assignmentId = c.req.param("assignmentId");
    if (!roomId || !assignmentId) {
      throw new ResponseError(400, "Room ID and assignment ID are required in parameter");
    }
    const response = await PCActivityRoomService.removeMentorAssignment(
      admin,
      { id: assignmentId, room_id: roomId },
      getAuditRequestContext(c),
    );
    return c.json({ data: response });
  }

  static async reopenMentorAssignment(c: Context<{ Variables: AdminVariables }>) {
    const admin = c.var.admin;
    const roomId = c.req.param("id");
    const assignmentId = c.req.param("assignmentId");
    if (!roomId || !assignmentId) {
      throw new ResponseError(400, "Room ID and assignment ID are required in parameter");
    }
    const response = await PCActivityRoomService.reopenMentorAssignment(
      admin,
      { id: assignmentId, room_id: roomId },
      getAuditRequestContext(c),
    );
    return c.json({ data: response });
  }

  static async moveMentorAssignment(c: Context<{ Variables: AdminVariables }>) {
    const admin = c.var.admin;
    const roomId = c.req.param("id");
    const assignmentId = c.req.param("assignmentId");
    if (!roomId || !assignmentId) {
      throw new ResponseError(400, "Room ID and assignment ID are required in parameter");
    }
    const body = (await c.req.json()) as { target_room_id: string };
    const response = await PCActivityRoomService.moveMentorAssignment(
      admin,
      { id: assignmentId, room_id: roomId, target_room_id: body.target_room_id },
      getAuditRequestContext(c),
    );
    return c.json({ data: response });
  }

  static async bulkEndMentorAssignments(c: Context<{ Variables: AdminVariables }>) {
    const admin = c.var.admin;
    const roomId = c.req.param("id");
    if (!roomId) throw new ResponseError(400, "Room ID is required in parameter");
    const body = (await c.req.json()) as BulkEndPcActivityRoomMentorAssignmentsRequest;
    const response = await PCActivityRoomService.bulkEndMentorAssignments(
      admin,
      { ...body, room_id: roomId },
      getAuditRequestContext(c),
    );
    return c.json({ data: response });
  }

  static async bulkRemoveMentorAssignments(c: Context<{ Variables: AdminVariables }>) {
    const admin = c.var.admin;
    const roomId = c.req.param("id");
    if (!roomId) throw new ResponseError(400, "Room ID is required in parameter");
    const body = (await c.req.json()) as BulkRemovePcActivityRoomMentorAssignmentsRequest;
    const response = await PCActivityRoomService.bulkRemoveMentorAssignments(
      admin,
      { ...body, room_id: roomId },
      getAuditRequestContext(c),
    );
    return c.json({ data: response });
  }

  static async bulkReopenMentorAssignments(c: Context<{ Variables: AdminVariables }>) {
    const admin = c.var.admin;
    const roomId = c.req.param("id");
    if (!roomId) throw new ResponseError(400, "Room ID is required in parameter");
    const body = (await c.req.json()) as BulkReopenPcActivityRoomMentorAssignmentsRequest;
    const response = await PCActivityRoomService.bulkReopenMentorAssignments(
      admin,
      { ...body, room_id: roomId },
      getAuditRequestContext(c),
    );
    return c.json({ data: response });
  }

  static async bulkMoveMentorAssignments(c: Context<{ Variables: AdminVariables }>) {
    const admin = c.var.admin;
    const roomId = c.req.param("id");
    if (!roomId) throw new ResponseError(400, "Room ID is required in parameter");
    const body = (await c.req.json()) as BulkMovePcActivityRoomMentorAssignmentsRequest;
    const response = await PCActivityRoomService.bulkMoveMentorAssignments(
      admin,
      { ...body, room_id: roomId },
      getAuditRequestContext(c),
    );
    return c.json({ data: response });
  }

  static async listEligibleStudents(c: Context<{ Variables: AdminVariables }>) {
    const admin = c.var.admin;
    const roomId = c.req.param("id");
    if (!roomId) throw new ResponseError(400, "Room ID is required in parameter");
    const response = await PCActivityRoomService.listEligibleStudents(admin, {
      room_id: roomId,
    });
    return c.json({ data: response });
  }

  static async listStudents(c: Context<{ Variables: AdminVariables }>) {
    const admin = c.var.admin;
    const roomId = c.req.param("id");
    if (!roomId) throw new ResponseError(400, "Room ID is required in parameter");
    const response = await PCActivityRoomService.listStudents(admin, { room_id: roomId });
    return c.json({ data: response });
  }

  static async bulkAssignStudents(c: Context<{ Variables: AdminVariables }>) {
    const admin = c.var.admin;
    const roomId = c.req.param("id");
    if (!roomId) throw new ResponseError(400, "Room ID is required in parameter");
    const body = (await c.req.json()) as BulkAssignPcActivityRoomStudentsRequest;
    const response = await PCActivityRoomService.bulkAssignStudents(
      admin,
      { ...body, room_id: roomId },
      getAuditRequestContext(c),
    );
    return c.json({ data: response });
  }

  static async endStudentAssignment(c: Context<{ Variables: AdminVariables }>) {
    const admin = c.var.admin;
    const roomId = c.req.param("id");
    const assignmentId = c.req.param("assignmentId");
    if (!roomId || !assignmentId) {
      throw new ResponseError(400, "Room ID and assignment ID are required in parameter");
    }
    const response = await PCActivityRoomService.endStudentAssignment(
      admin,
      { room_id: roomId, assignment_id: assignmentId },
      getAuditRequestContext(c),
    );
    return c.json({ data: response });
  }

  static async dropStudentAssignment(c: Context<{ Variables: AdminVariables }>) {
    const admin = c.var.admin;
    const roomId = c.req.param("id");
    const assignmentId = c.req.param("assignmentId");
    if (!roomId || !assignmentId) {
      throw new ResponseError(400, "Room ID and assignment ID are required in parameter");
    }
    const response = await PCActivityRoomService.dropStudentAssignment(
      admin,
      { room_id: roomId, assignment_id: assignmentId },
      getAuditRequestContext(c),
    );
    return c.json({ data: response });
  }

  static async reopenStudentAssignment(c: Context<{ Variables: AdminVariables }>) {
    const admin = c.var.admin;
    const roomId = c.req.param("id");
    const assignmentId = c.req.param("assignmentId");
    if (!roomId || !assignmentId) {
      throw new ResponseError(400, "Room ID and assignment ID are required in parameter");
    }
    const response = await PCActivityRoomService.reopenStudentAssignment(
      admin,
      { room_id: roomId, assignment_id: assignmentId },
      getAuditRequestContext(c),
    );
    return c.json({ data: response });
  }

  static async moveStudent(c: Context<{ Variables: AdminVariables }>) {
    const admin = c.var.admin;
    const roomId = c.req.param("id");
    const assignmentId = c.req.param("assignmentId");
    if (!roomId || !assignmentId) {
      throw new ResponseError(400, "Room ID and assignment ID are required in parameter");
    }
    const body = (await c.req.json()) as { target_room_id: string };
    const response = await PCActivityRoomService.moveStudent(
      admin,
      { room_id: roomId, assignment_id: assignmentId, target_room_id: body.target_room_id },
      getAuditRequestContext(c),
    );
    return c.json({ data: response });
  }

  static async bulkEndStudentAssignments(c: Context<{ Variables: AdminVariables }>) {
    const admin = c.var.admin;
    const roomId = c.req.param("id");
    if (!roomId) throw new ResponseError(400, "Room ID is required in parameter");
    const body = (await c.req.json()) as BulkEndPcActivityRoomStudentAssignmentsRequest;
    const response = await PCActivityRoomService.bulkEndStudentAssignments(
      admin,
      { ...body, room_id: roomId },
      getAuditRequestContext(c),
    );
    return c.json({ data: response });
  }

  static async bulkDropStudentAssignments(c: Context<{ Variables: AdminVariables }>) {
    const admin = c.var.admin;
    const roomId = c.req.param("id");
    if (!roomId) throw new ResponseError(400, "Room ID is required in parameter");
    const body = (await c.req.json()) as BulkDropPcActivityRoomStudentAssignmentsRequest;
    const response = await PCActivityRoomService.bulkDropStudentAssignments(
      admin,
      { ...body, room_id: roomId },
      getAuditRequestContext(c),
    );
    return c.json({ data: response });
  }

  static async bulkReopenStudentAssignments(c: Context<{ Variables: AdminVariables }>) {
    const admin = c.var.admin;
    const roomId = c.req.param("id");
    if (!roomId) throw new ResponseError(400, "Room ID is required in parameter");
    const body = (await c.req.json()) as BulkReopenPcActivityRoomStudentAssignmentsRequest;
    const response = await PCActivityRoomService.bulkReopenStudentAssignments(
      admin,
      { ...body, room_id: roomId },
      getAuditRequestContext(c),
    );
    return c.json({ data: response });
  }

  static async bulkMoveStudentAssignments(c: Context<{ Variables: AdminVariables }>) {
    const admin = c.var.admin;
    const roomId = c.req.param("id");
    if (!roomId) throw new ResponseError(400, "Room ID is required in parameter");
    const body = (await c.req.json()) as BulkMovePcActivityRoomStudentAssignmentsRequest;
    const response = await PCActivityRoomService.bulkMoveStudentAssignments(
      admin,
      { ...body, room_id: roomId },
      getAuditRequestContext(c),
    );
    return c.json({ data: response });
  }

  static async reassignStudent(c: Context<{ Variables: AdminVariables }>) {
    const admin = c.var.admin;
    const roomId = c.req.param("id");
    const studentId = c.req.param("studentId");
    if (!roomId || !studentId) {
      throw new ResponseError(400, "Room ID and student ID are required in parameter");
    }
    const body = (await c.req.json()) as { source_assignment_id: string };
    const response = await PCActivityRoomService.reassignStudent(
      admin,
      { room_id: roomId, student_id: studentId, source_assignment_id: body.source_assignment_id },
      getAuditRequestContext(c),
    );
    return c.json({ data: response });
  }
}
