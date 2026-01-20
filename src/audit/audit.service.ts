// src/audit/audit.service.ts
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AuditLog } from './audit.entity';
import { AdminAction } from 'src/admin/enums/admin-action.enum';
@Injectable()
export class AuditService {
  constructor(
    @InjectRepository(AuditLog)
    private readonly auditRepo: Repository<AuditLog>,
  ) {}

  async log(data: {
    adminId: string;
    targetId: string;
    action: AdminAction;
    reason?: string;
  }) {
    const log = this.auditRepo.create(data);
    return this.auditRepo.save(log);
  }

  // audit.service.ts
  async findAll(action?: AdminAction) {
    if (action) {
      return this.auditRepo.find({ where: { action } });
    }
    return this.auditRepo.find();
  }
}
