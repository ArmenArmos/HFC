'use server'

import { hash } from 'bcryptjs'
import { db } from '@/lib/db'
import { signUpSchema } from '@/lib/validation/auth'
import { UserRole, UserStatus } from '@prisma/client'

export async function registerUser(formData: FormData) {
  try {
    // Parse and validate form data
    const rawData = {
      name: formData.get('name') as string,
      email: formData.get('email') as string,
      password: formData.get('password') as string,
      confirmPassword: formData.get('confirmPassword') as string,
      role: formData.get('role') as 'PATIENT' | 'DOCTOR',
      locale: formData.get('locale') as 'en' | 'hy' | 'ru',
    }

    const validatedData = signUpSchema.parse(rawData)

    // Check if user already exists
    const existingUser = await db.user.findUnique({
      where: { email: validatedData.email },
    })

    if (existingUser) {
      return {
        success: false,
        error: 'User with this email already exists',
      }
    }

    // Hash password
    const passwordHash = await hash(validatedData.password, 12)

    // Create user
    const user = await db.user.create({
      data: {
        name: validatedData.name,
        email: validatedData.email,
        passwordHash,
        role: validatedData.role as UserRole,
        locale: validatedData.locale,
        status: UserStatus.PENDING_VERIFICATION,
      },
    })

    // Create role-specific profile
    if (validatedData.role === 'PATIENT') {
      await db.patient.create({
        data: {
          userId: user.id,
        },
      })
    } else if (validatedData.role === 'DOCTOR') {
      await db.doctor.create({
        data: {
          userId: user.id,
        },
      })
    }

    // Create audit log
    await db.auditLog.create({
      data: {
        userId: user.id,
        action: 'LOGIN',
        resource: 'auth:register',
        metadata: {
          role: validatedData.role,
        },
      },
    })

    return {
      success: true,
      message: 'Account created successfully',
    }
  } catch (error: any) {
    console.error('Registration error:', error)
    return {
      success: false,
      error: error.message || 'Failed to create account',
    }
  }
}
