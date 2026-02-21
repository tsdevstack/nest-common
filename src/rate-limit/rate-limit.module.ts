import { Module, Global } from "@nestjs/common";
import { RateLimitGuard } from "./rate-limit.guard";
import { RedisModule } from "../redis/redis.module";

@Global()
@Module({
  imports: [RedisModule],
  providers: [RateLimitGuard],
  exports: [RateLimitGuard],
})
export class RateLimitModule {}
