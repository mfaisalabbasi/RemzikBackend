import { Repository } from 'typeorm';
import { AuditLog } from './audit.entity';
import { AuditAction } from './enums/audit-action.enum';
import { InjectRepository } from '@nestjs/typeorm';
import { Injectable } from '@nestjs/common';

@Injectable()
export class AuditService {
  constructor(
    @InjectRepository(AuditLog)
    private readonly auditRepo: Repository<AuditLog>,
  ) {}

  async log(
    adminId: string,
    targetType: string,
    targetId: string,
    action: AuditAction,
    reason?: string,
  ) {
    const log = this.auditRepo.create({
      adminId,
      targetType,
      targetId,
      action,
      reason,
    });

    return this.auditRepo.save(log);
  }
}
