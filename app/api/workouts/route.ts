import { NextResponse } from "next/server";
import { withAuth } from "@/lib/auth/api";
import { listWorkouts, searchWorkouts } from "@/lib/db/workouts";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const query = searchParams.get("q")?.trim() ?? "";
    const limit = Math.min(Number(searchParams.get("limit") ?? 20), 50);

    return await withAuth(async ({ user }) => {
      const workouts = query
        ? await searchWorkouts(user.id, { query, limit })
        : await listWorkouts(user.id, { limit });

      return NextResponse.json({
        workouts: workouts.map((workout) => ({
          id: workout.id,
          exercise: workout.exercise,
          sets: workout.sets,
          reps: workout.reps,
          weight_kg: workout.weight_kg,
          duration_min: workout.duration_min,
          notes: workout.notes,
          logged_at: workout.logged_at,
        })),
      });
    });
  } catch (error) {
    console.error("GET /api/workouts error:", error);
    return NextResponse.json(
      { error: "Failed to load workouts" },
      { status: 500 },
    );
  }
}
