-- AddForeignKey
ALTER TABLE "passion_connection_activities" ADD CONSTRAINT "passion_connection_activities_academic_year_id_fkey" FOREIGN KEY ("academic_year_id") REFERENCES "academic_years"("id") ON DELETE SET NULL ON UPDATE CASCADE;
