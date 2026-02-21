import { Module, Global } from "@nestjs/common";
import { EmailRateLimitGuard } from "./email-rate-limit.guard";
import { RedisModule } from "../redis/redis.module";

@Global()
@Module({
  imports: [RedisModule],
  providers: [EmailRateLimitGuard],
  exports: [EmailRateLimitGuard],
})
export class EmailRateLimitModule {}
