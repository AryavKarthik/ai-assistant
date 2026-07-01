import { NextResponse } from "next/server";
import { withAuth } from "@/lib/auth/api";
import {
  deleteWorkout,
  getWorkoutForUser,
  updateWorkout,
} from "@/lib/db/workouts";

interface RouteContext {
  params: Promise<{ id: string }>;
}

function parseOptionalNumber(value: unknown): number | null | undefined {
  if (value === null) return null;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

export async function PATCH(request: Request, context: RouteContext) {
  try {
    const { id } = await context.params;
    const body = await request.json();

    return await withAuth(async ({ user }) => {
      const existing = await getWorkoutForUser(user.id, id);
      if (!existing) {
        return NextResponse.json({ error: "Workout not found" }, { status: 404 });
      }

      const exercise =
        typeof body.exercise === "string" ? body.exercise.trim() : undefined;
      const sets = parseOptionalNumber(body.sets);
      const reps = parseOptionalNumber(body.reps);
      const weight_kg = parseOptionalNumber(body.weight_kg);
      const duration_min = parseOptionalNumber(body.duration_min);
      const notes =
        typeof body.notes === "string"
          ? body.notes
          : body.notes === null
            ? null
            : undefined;

      if (
        !exercise &&
        sets === undefined &&
        reps === undefined &&
        weight_kg === undefined &&
        duration_min === undefined &&
        notes === undefined
      ) {
        return NextResponse.json(
          { error: "Provide at least one field to update" },
          { status: 400 },
        );
      }

      const workout = await updateWorkout(user.id, id, {
        ...(exercise ? { exercise } : {}),
        ...(sets !== undefined ? { sets } : {}),
        ...(reps !== undefined ? { reps } : {}),
        ...(weight_kg !== undefined ? { weight_kg } : {}),
        ...(duration_min !== undefined ? { duration_min } : {}),
        ...(notes !== undefined ? { notes } : {}),
      });

      return NextResponse.json({
        workout: {
          id: workout.id,
          exercise: workout.exercise,
          sets: workout.sets,
          reps: workout.reps,
          weight_kg: workout.weight_kg,
          duration_min: workout.duration_min,
          notes: workout.notes,
          logged_at: workout.logged_at,
        },
      });
    });
  } catch (error) {
    console.error("PATCH /api/workouts/[id] error:", error);
    return NextResponse.json(
      { error: "Failed to update workout" },
      { status: 500 },
    );
  }
}

export async function DELETE(_request: Request, context: RouteContext) {
  try {
    const { id } = await context.params;
    return await withAuth(async ({ user }) => {
      const deleted = await deleteWorkout(user.id, id);
      if (!deleted) {
        return NextResponse.json({ error: "Workout not found" }, { status: 404 });
      }
      return NextResponse.json({ success: true });
    });
  } catch (error) {
    console.error("DELETE /api/workouts/[id] error:", error);
    return NextResponse.json(
      { error: "Failed to delete workout" },
      { status: 500 },
    );
  }
}
