import { FieldProps } from 'formik';
import React, { FunctionComponent, memo, useCallback, useMemo } from 'react';

import { TranslatedString } from '@bigcommerce/checkout/locale';

import { FormField, TextInput } from '../ui/form';

export interface EmailFieldProps {
    isFloatingLabelEnabled?: boolean;
    onChange?(value: string): void;
    label?: string;
}

const EmailField: FunctionComponent<EmailFieldProps> = ({ onChange, isFloatingLabelEnabled, label }) => {
    const renderInput = useCallback(
        (props: FieldProps) => (
            <TextInput
                {...props.field}
                autoComplete={props.field.name}
                id={props.field.name}
                isFloatingLabelEnabled={isFloatingLabelEnabled}
                type="email"
            />
        ),
        [isFloatingLabelEnabled],
    );

    const labelContent = useMemo(
        () => label || <TranslatedString id="customer.email_label" />,
        [label]
    );

    return (
        <FormField
            input={renderInput}
            isFloatingLabelEnabled={isFloatingLabelEnabled}
            labelContent={labelContent}
            name="email"
            onChange={onChange}
        />
    );
};
export default memo(EmailField);
