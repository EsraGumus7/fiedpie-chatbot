-- WorkForce_Prod uzerinde calistirin (Kişi 2 / admin panel)
USE [WorkForce_Prod];
GO

IF OBJECT_ID('dbo.AiRolePermission', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.AiRolePermission (
    Id BIGINT IDENTITY(1,1) PRIMARY KEY,
    CreateTime DATETIME NOT NULL DEFAULT GETDATE(),
    UpdateTime DATETIME NOT NULL DEFAULT GETDATE(),
    UpdatedBy VARCHAR(250) NOT NULL DEFAULT 'system',
    Deleted BIT NOT NULL DEFAULT 0,
    RoleId BIGINT NOT NULL,
    Intent VARCHAR(200) NOT NULL
  );
END
GO

IF OBJECT_ID('dbo.AiUserScope', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.AiUserScope (
    Id BIGINT IDENTITY(1,1) PRIMARY KEY,
    CreateTime DATETIME NOT NULL DEFAULT GETDATE(),
    UpdateTime DATETIME NOT NULL DEFAULT GETDATE(),
    UpdatedBy VARCHAR(250) NOT NULL DEFAULT 'system',
    Deleted BIT NOT NULL DEFAULT 0,
    UserId BIGINT NOT NULL,
    ScopeType VARCHAR(50) NOT NULL,
    ScopeValue VARCHAR(250) NOT NULL
  );
END
GO

-- Opsiyonel: audit (panel bos liste gosterir tablo yoksa)
IF OBJECT_ID('dbo.AiAuditLog', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.AiAuditLog (
    Id BIGINT IDENTITY(1,1) PRIMARY KEY,
    CreateTime DATETIME NOT NULL DEFAULT GETDATE(),
    UpdatedBy VARCHAR(250) NOT NULL DEFAULT 'system',
    Deleted BIT NOT NULL DEFAULT 0,
    ActorUserId VARCHAR(250) NULL,
    Action VARCHAR(100) NOT NULL,
    TargetType VARCHAR(50) NULL,
    TargetId VARCHAR(100) NULL,
    BeforeJson NVARCHAR(MAX) NULL,
    AfterJson NVARCHAR(MAX) NULL
  );
END
GO
