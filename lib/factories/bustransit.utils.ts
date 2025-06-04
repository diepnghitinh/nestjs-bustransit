import {ClassTransformOptions, plainToClass} from "@nestjs/class-transformer";
import {validate, ValidatorOptions} from "@nestjs/class-validator";
import {ValidationError} from "@nestjs/common";

export async function parseClassAndValidate<T, V extends object>(
    cls: new (...args: any[]) => T,
    plainObject: V,
    transformOptions?: ClassTransformOptions,
    validatorOptions?: ValidatorOptions,
): Promise<T> {
    const transformedObject = plainToClass(cls, plainObject, transformOptions);

    const errors = await validate(transformedObject as object, validatorOptions);

    if (errors.length > 0) {
        const errorMessages = errors.map((error: ValidationError) => {
            if (error.constraints) {
                return `${error.property}: ${Object.values(error.constraints).join(', ')}`;
            }
            return `${error.property}: Validation failed`;
        });
        throw new Error(`Parsing failed due to validation errors: ${errorMessages.join('; ')}`);
    }

    return transformedObject;
}